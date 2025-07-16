// Node.js + Express + LINE SDK + OpenAI
const express = require('express');
const line = require('@line/bot-sdk');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const completion = await openai.createChatCompletion({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: userMessage }],
      });

      const botReply = completion.data.choices[0].message.content;

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: botReply,
      });
    }
  }
  res.sendStatus(200);
});

app.listen(3000, () => console.log('Bot is running'));
