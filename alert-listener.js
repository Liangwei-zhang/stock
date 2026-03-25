/**
 * Stock Alert → Telegram Forwarder
 * 使用原生 fetch 監聽 SSE
 *
 * 執行方式（Node 20+）：
 *   node --env-file=.env alert-listener.js
 * 或先 export 環境變數後執行：
 *   export TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy
 *   node alert-listener.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ 缺少環境變數：TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 必須設定');
  console.error('   請執行：node --env-file=.env alert-listener.js');
  process.exit(1);
}

const processed = new Set();

async function sendTelegram(msg) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'HTML'
      })
    });
    const result = await res.json();
    console.log('📤 Telegram:', result.ok ? 'OK' : 'FAIL');
    return result.ok;
  } catch (e) {
    console.error('❌', e.message);
    return false;
  }
}

async function start() {
  console.log('🔌 連接中...');

  let reader;
  try {
    const res = await fetch(`${API_URL}/alerts-stream`);
    reader = res.body.getReader();
  } catch (e) {
    console.error('❌ 無法連接伺服器:', e.message);
    console.log('   5秒後重連...');
    setTimeout(start, 5000);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  
  console.log('✅ 已連接');
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          
          // init
          if (data.type === 'init' && data.alerts) {
            console.log('📡 初始預警:', data.alerts.length);
            data.alerts.forEach(a => processed.add(a.id));
            continue;
          }
          
          // update
          const alert = data.alert || data;
          if (processed.has(alert.id)) continue;
          processed.add(alert.id);
          
          // 發送
          const levelMap = { high: '高', medium: '中', low: '低' };
          const level = levelMap[alert.level] || alert.level || '-';
          const typeStr = alert.type === 'buy' ? '買入' : alert.type === 'sell' ? '賣出' : (alert.signal === 'buy' ? '買入' : alert.signal === 'sell' ? '賣出' : '信號');
const emoji = alert.type === 'buy' || alert.signal === 'buy' ? '🟢' : alert.type === 'sell' || alert.signal === 'sell' ? '🔴' : '⚪';
          const reasons = (alert.reasons || []).join('\n• ');
          
          const msg = `🛎️ 股票預警\n\n${emoji} ${alert.symbol} ${typeStr}\n等級: ${level}\n價格: $${alert.price || '-'}\n評分: ${alert.score || '-'}分\n\n• ${reasons}`;
          
          console.log('🔔', alert.symbol);
          await sendTelegram(msg);
          
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }
  
  console.log('❌ 斷開，5秒後重連...');
  setTimeout(start, 5000);
}

start();
