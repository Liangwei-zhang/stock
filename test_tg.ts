import fs from 'fs';
async function test() {
const env = fs.readFileSync('.env', 'utf8');
let botToken = '';let chatId = '';
env.split('\n').forEach(line => {
const matchToken = line.match(/TELEGRAM_BOT_TOKEN\s*=\s*(.*)/);
if (matchToken) botToken = matchToken[1].replace(/["']/g, '').trim();
const matchId = line.match(/TELEGRAM_CHAT_ID\s*=\s*(.*)/);
if (matchId) chatId = matchId[1].replace(/["']/g, '').trim();
});
if (!botToken || botToken.includes('你的')) {console.log('X No Token'); return;}
if (!chatId || chatId.includes('你的')) {console.log('X No ID'); return;}
console.log('Testing ID: ' + chatId);
const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
try {
const response = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({chat_id: chatId, text: '🚀 *量化系統連線測試成功！* 
這是一條來自系統的測試訊息，如果您看到這個代表推播串接已經順利完成啦！', parse_mode: 'Markdown'})
});
const data = await response.json();
if (response.ok) {console.log('✅ 發送成功！請檢查 Telegram 機器人對話！');}
else {console.log('❌ 發送失敗，錯誤詳情：', data);}
} catch (err) {console.error('❌ 發送異常：', err);}
}
test();
