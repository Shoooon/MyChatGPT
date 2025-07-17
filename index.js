// Node.js + Express + LINE SDK + OpenAI
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const chatHistories = {}; // { contextKey: [ { role, content }, ... ] }

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
      let userMessage = event.message.text;
      const isUserChat = event.source.type === 'user';
      const isGroupChat = event.source.type === 'group' || event.source.type === 'room';
      const wasMentioned = userMessage.includes('@NotGPT');

      userMessage = userMessage.replace('@NotGPT', '').trim();

      const contextKey = event.source.groupId || event.source.userId;
      if (!chatHistories[contextKey]) {
        chatHistories[contextKey] = [];
      }

      let displayName = '誰か';
      if (isGroupChat) {
        try {
          const profile = await client.getGroupMemberProfile(event.source.groupId, event.source.userId);
          displayName = profile.displayName;
        } catch (e) {
          console.warn('名前取得失敗');
        }
      }

      const formattedUserMessage = `【${displayName}】：${userMessage}`;
      chatHistories[contextKey].push({ role: 'user', content: formattedUserMessage });

      const formattedMessages = chatHistories[contextKey].map(msg => ({
        role: msg.role,
        content: [{ type: 'text', text: msg.content }],
      }));

      const shouldRespond = isUserChat || (isGroupChat && wasMentioned);
      if (!shouldRespond) continue; // 応答しないが履歴は記録済み

      // ステップ1：検索が必要かGPTに判断させる
      const judgmentPrompt = [
        {
          role: 'system',
          content: 'あなたはユーザーの質問に答えるアシスタントです。質問があなたの知識だけでは不十分と思われる場合、「検索が必要です」とだけ返答してください。'
        },
        {
          role: 'user',
          content: userMessage
        }
      ];

      const judgment = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: judgmentPrompt,
      });

      const decision = judgment.choices[0].message.content;

      let botReply;
      if (decision.includes('検索が必要')) {
        const keywordPrompt = `以下の質問から検索に適したキーワードを3〜6語で抜き出してください。\n質問：${userMessage}\n検索キーワード：`;

        const keywordExtract = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: keywordPrompt }]
        });

        const keywords = keywordExtract.choices[0].message.content;

        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': process.env.SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: keywords }),
        });

        const json = await searchRes.json();
        const snippet = json.organic?.[0]?.snippet || '検索結果が取得できませんでした。';

        const searchPrompt = [
          ...formattedMessages,
          {
            role: 'system',
            content: '以下の検索結果を参考にしてユーザーの質問に答えてください。正確かつ簡潔に答えてください。'
          },
          {
            role: 'user',
            content: `検索結果：${snippet}\n質問：${userMessage}`
          }
        ];

        const final = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: searchPrompt
        });

        botReply = final.choices[0].message.content || 'しらねぇよ';
      } else {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: formattedMessages
        });

        botReply = completion?.choices?.[0]?.message?.content || 'しらねぇよ';
      }

      chatHistories[contextKey].push({ role: 'assistant', content: botReply });
      if (chatHistories[contextKey].length > 40) {
        chatHistories[contextKey] = chatHistories[contextKey].slice(-40);
      }

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: botReply,
      });
    }
  }
  res.sendStatus(200);
});

app.listen(3000, () => console.log('Bot is running'));
