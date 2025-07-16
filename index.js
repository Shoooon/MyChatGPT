// Node.js + Express + LINE SDK + OpenAI
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fetch = require('node-fetch');

const app = express();
// app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const isUserChat = event.source.type === 'user';
      const isGroupChat = event.source.type === 'group' || event.source.type === 'room';
      const wasMentioned = event.message.mentioned?.mentions?.length > 0;
      // 応答する条件：個人トーク or グループでメンションされた場合
      const shouldRespond = isUserChat || (isGroupChat && wasMentioned);
      if (!shouldRespond) {
        return; // 応答しない
      }
      //if (!userMessage.includes('@NotGPT')) {
      //  continue;
      //}

      // 「検索」または「調べ」という単語が含まれているか？
      const needsSearch = /検索|調べ/.test(userMessage);
      
      if (needsSearch) {
        const query = event.message.text.trim();
        const botReply = await getSearchBasedResponse(query);   
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: botReply,
        });
      } else{
        const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: userMessage }],
        });
        const botReply = completion?.choices?.[0]?.message?.content || 'しらねぇよ';
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: botReply,
        });
      }
    }
  }
  res.sendStatus(200);
});

// Web検索→GPT連携の関数
async function getSearchBasedResponse(userQuery) {
  // Serper API呼び出し
  const searchRes = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: userQuery }),
  });
  const json = await searchRes.json();
  const snippet = json.organic?.[0]?.snippet || '検索結果が取得できませんでした。';

  const prompt = `以下はWeb検索結果です。これを参考にしてユーザーの質問に答えてください。\n\n検索結果: ${snippet}\n\n質問: ${userQuery}`;

  // ChatGPTに投げる
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });

  return completion?.choices?.[0]?.message?.content || 'しらねぇよ';
}
app.listen(3000, () => console.log('Bot is running'));
