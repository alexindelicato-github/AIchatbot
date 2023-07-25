import {Configuration, OpenAIApi } from "openai";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const configuration = new Configuration ({
    organization: "yourORGkeyHere",
    apiKey: "yourAPIkeyhere", 
});

const openai = new OpenAIApi(configuration);

const app = express();
const port = 3000;



app.use(bodyParser.json());
app.use(cors());

app.get('/', function(request, response){
    response.sendFile('index.html', { root: '.' });
});

app.post("/", async (req, res) => {
    
    const { messages } = req.body;

    console.log(messages)
    const completion = await openai.createChatCompletion({
        model: "gpt-4",
        messages: [
            {"role": "system", "content": "<This is where you give your AI chatbot a personality and purpose>"},
            ...messages
        ]
    })

    res.json({
        completion: completion.data.choices[0].message
    })

});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});
