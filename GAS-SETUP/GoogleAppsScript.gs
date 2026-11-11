/**
 * お気に入りボックス v1.1.8 → Googleスプレッドシート連携
 * スプレッドシートから拡張機能 → Apps Scriptを開いて、このコードを貼り付けます。
 * Apps Scriptの[プロジェクトの設定] → [スクリプト プロパティ] へ
 *   プロパティ: FAVBOX_ACCESS_CODE
 *   値: 自分で決めた半角英数字6～32文字
 * を保存してから setupSheet() を実行してください。
 * 合言葉の実際の値をこのソースコードに直書きしたり、GitHubに公開しないでください。
 * 6文字は簡易防御です。万全な本人認証ではなく、URLや合言葉の流出には注意が必要です。
 */
const FAVBOX = {
  SHEET_NAME: 'お気に入り一覧',
  HEADERS: ['ID', '登録日時', 'サービス', 'カテゴリ', 'タイトル', 'URL', 'メモ', '最終更新日時']
};

/** この関数を一度実行して、書き込み権限を承認します。 */
function setupSheet() {
  getAccessCode_(); // 設定漏れ・短すぎる合言葉はここで検出
  const sheet = getSheet_();
  Logger.log('準備できました：' + sheet.getParent().getUrl());
}

/** アプリからの登録／編集／削除を受信。外部からの内容をそのまま実行しません。 */
function doPost(e) {
  let payload = {}, cacheKey = '';
  try {
    payload = JSON.parse((e && e.parameter && e.parameter.payload) || '{}');
    if (!accessAllowed_(payload.key)) return ContentService.createTextOutput('unauthorized');
    const opId = String(payload.opId || '');
    if (!/^op[a-z0-9]{10,40}$/.test(opId)) throw new Error('操作IDが正しくありません');
    cacheKey = ackKey_(opId);
    const action = String(payload.action || '');
    if (action !== 'upsert' && action !== 'delete') throw new Error('操作の種類が不正です');
    const item = payload.item || {};
    const id = String(item.id || '');
    if (!/^f[a-z0-9]{8,45}$/.test(id)) throw new Error('登録IDが正しくありません');

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = getSheet_();
      const row = findById_(sheet, id);
      if (action === 'delete') {
        if (row > 0) sheet.deleteRow(row);
      } else {
        const url = String(item.url || '');
        if (!/^https?:\/\/\S{3,}$/i.test(url) || url.length > 2500) throw new Error('URLが不正です');
        const dateMs = Number(item.createdAt);
        const created = Number.isFinite(dateMs) && dateMs > 0 ? new Date(dateMs) : new Date();
        const values = [
          safeText_(id, 100),
          created,
          safeText_(item.platform, 50),
          safeText_(item.category, 200),
          safeText_(item.title, 600),
          safeText_(url, 2500),
          safeText_(item.memo, 5000),
          new Date()
        ];
        const target = row > 0 ? row : sheet.getLastRow() + 1;
        sheet.getRange(target, 1, 1, 8).setValues([values]);
        sheet.getRange(target, 2).setNumberFormat('yyyy/MM/dd HH:mm');
        sheet.getRange(target, 8).setNumberFormat('yyyy/MM/dd HH:mm');
      }
      // 受け取った操作IDで書込完了の印を保存 (6時間)。再送はIDで上書きするため重複しない。
      CacheService.getScriptCache().put(cacheKey, 'done', 21600);
    } finally {
      lock.releaseLock();
    }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    if (cacheKey) {
      try { CacheService.getScriptCache().put(cacheKey, 'failed', 900); } catch (_) {}
    }
    console.error('Favorite box sync: ' + String(err));
    return ContentService.createTextOutput('error');
  }
}

/** JSONP: 接続確認／操作確認／公開Webページのタイトル取得だけを返します。 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const cb = String(p.callback || '');
  // 任意のJavaScriptを実行させないため、コールバック名を厳格にチェック
  if (!/^favSheetCb_[a-z0-9_]{8,24}$/.test(cb)) {
    return ContentService.createTextOutput('invalid callback');
  }
  let result;
  try {
    if (!accessAllowed_(p.key)) {
      result = {ok:false, error:'合言葉が一致しません。GASのスクリプト プロパティとアプリの入力を確認してください'};
    } else if (p.mode === 'ping') {
      getSheet_(); // 実際に保存先が開けることを検証
      result = {ok:true, status:'ready'};
    } else if (p.mode === 'ack') {
      const opId = String(p.opId || '');
      if (!/^op[a-z0-9]{10,40}$/.test(opId)) throw new Error('操作IDが不正です');
      result = {ok:true, status:CacheService.getScriptCache().get(ackKey_(opId)) || 'pending'};
    } else if (p.mode === 'meta') {
      const title = fetchPublicTitle_(String(p.url || ''));
      result = {ok:true, title:title};
    } else {
      result = {ok:false, error:'操作が不正です'};
    }
  } catch (err) {
    result = {ok:false, error:'GASの公開設定とシートへの権限をご確認ください'};
  }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(result) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** Script Propertiesのみで管理する合言葉。公開ソースへ値を埋め込まない。 */
function getAccessCode_() {
  const key = String(PropertiesService.getScriptProperties().getProperty('FAVBOX_ACCESS_CODE') || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(key)) throw new Error('FAVBOX_ACCESS_CODEを半角英数字6～32文字でスクリプト プロパティに設定してください');
  return key;
}
function accessAllowed_(supplied) {
  // 桁数を隠すため32文字分を比較し、長さも含めて一致したときだけ認証。
  const expected = getAccessCode_();
  const actual = String(supplied || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(actual)) return false;
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < 32; i++) {
    diff |= (expected.charCodeAt(i) || 0) ^ (actual.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function ackKey_(opId) {
  // 操作IDはランダムな値。受信確認は同じ操作IDで参照します。
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, opId);
  return 'fav:' + Utilities.base64EncodeWebSafe(bytes).slice(0, 40);
}
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('必ず対象スプレッドシートから Apps Script を開いてください');
  let sheet = ss.getSheetByName(FAVBOX.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(FAVBOX.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 8).setValues([FAVBOX.HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setBackground('#285a7b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setColumnWidth(1, 185); sheet.setColumnWidth(2, 148);
    sheet.setColumnWidth(3, 125); sheet.setColumnWidth(4, 145);
    sheet.setColumnWidth(5, 260); sheet.setColumnWidth(6, 460);
    sheet.setColumnWidth(7, 280); sheet.setColumnWidth(8, 148);
  } else {
    const first = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];
    if (first.join('|') !== FAVBOX.HEADERS.join('|')) {
      throw new Error('既存の「お気に入り一覧」タブの1行目が異なります。別名へ移動するか、専用の新しいシートをご用意ください');
    }
  }
  return sheet;
}
function findById_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const found = sheet.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return found ? found.getRow() : -1;
}
function safeText_(input, limit) {
  let v = String(input == null ? '' : input).slice(0, limit).replace(/\u0000/g, '');
  // Google Sheetsの数式として解釈されないよう、先頭の危険な文字をエスケープ
  if (/^[\s]*[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

/** Public metadata only. Some social networks block scraping; empty means unavailable. */
function fetchPublicTitle_(raw) {
  // GAS V8 does not expose the browser URL constructor. Accept HTTPS links with public domain names only.
  if (!raw || raw.length > 2500) return '';
  const m=raw.match(/^https:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
  if (!m) return '';
  const host=m[1].toLowerCase();
  // Reject credentials, ports, IPs and local/intranet hostnames. Redirects disabled below.
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      /(?:^|\.)(?:local|internal|localhost|test|invalid)$/.test(host) ||
      /(?:^|\.)(?:localhost|localdomain)$/.test(host) ||
      /^\d+(?:\.\d+)*$/.test(host)) return '';
  const cache=CacheService.getScriptCache();
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  const cacheKey='title:'+Utilities.base64EncodeWebSafe(digest).slice(0,38);
  const previous=cache.get(cacheKey);
  if(previous!==null)return previous==='-'?'':previous;
  let title='';
  try {
    // oEmbed usually provides higher quality video titles without scraping pages.
    let api='';
    if (/(^|\.)youtu\.be$/.test(host) || /(^|\.)youtube\.com$/.test(host)) {
      api='https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(raw);
    }
    if(api) {
      const r=UrlFetchApp.fetch(api,{muteHttpExceptions:true,followRedirects:false,headers:{'User-Agent':'Mozilla/5.0'}});
      if(r.getResponseCode()===200) {
        const obj=JSON.parse(r.getContentText());
        title=String(obj.title||'').trim();
      }
    }
    if(!title) {
      const r=UrlFetchApp.fetch(raw,{muteHttpExceptions:true,followRedirects:false,headers:{'User-Agent':'Mozilla/5.0 (compatible; PersonalBookmarks/1.0)','Accept':'text/html'}});
      const code=r.getResponseCode();
      const headers=r.getAllHeaders();
      const type=String(headers['Content-Type']||headers['content-type']||'');
      if(code>=200&&code<300&&(/text\/html|application\/xhtml|^$/i.test(type))) {
        const body=r.getContentText().slice(0,250000);
        // Meta attributes may appear in either order and may use mixed quote styles.
        const tags=body.match(/<meta\b[^>]*>/gi)||[];
        for(const wanted of ['og:title','twitter:title']) {
          for(const tag of tags) {
            const attrs={};
            tag.replace(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g,(_,k,q,v)=>{attrs[k.toLowerCase()]=v;return '';});
            if((attrs.property||attrs.name||'').toLowerCase()===wanted && attrs.content){title=attrs.content.trim();break;}
          }
          if(title)break;
        }
        if(!title){const m=body.match(/<title[^>]*>([\s\S]{1,280}?)<\/title>/i);if(m)title=m[1].trim();}
      }
    }
  }catch(e){console.warn('Metadata unavailable: '+String(e).slice(0,140));}
  title=String(title).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
  cache.put(cacheKey,title||'-',21600);
  return title;
}
