<<<<<<< HEAD
# AIchatbot
Creating an AI Chatbot using gpt-4


Create a working directory 
run npm init <br>
Add type: module <br>
Install required packages like body-parser, express, cors etc. 

Also required to have an API key from chatgpt

Follow the sample files in the repo to build out your very own AI chatbot
=======
# AI Security Chatbot

An enhanced AI chatbot with chat history persistence and file upload capabilities, powered by OpenAI's GPT-4.

## Features

- 💬 **Chat with GPT-4**: Interact with a sophisticated AI trained to provide cybersecurity assistance
- 📁 **File Upload**: Upload code files, configurations, or any text files for AI analysis
- 🛡️ **Content Moderation**: User messages and attached files are screened with the OpenAI Moderation API before reaching GPT-4
- 🔎 **CVE Enrichment**: CVE IDs mentioned in a message are looked up in the [OSV.dev](https://osv.dev) vulnerability database and the details are given to GPT-4 as reference context
- 📚 **Knowledge Base (RAG)**: Admins upload reference documents (policies, runbooks, standards), which are embedded and stored in a Qdrant vector database. Relevant excerpts are retrieved and given to GPT-4 with each question
- 📜 **Chat History**: Conversations are saved and can be revisited
- 🔄 **Conversation Management**: Create, rename, delete, and switch between conversations
- 💾 **Export Options**: Download your conversations as JSON or CSV files
- 🖥️ **Customizable Layout**: Position chatbot on left/right/center of screen, resize with mouse handles, and customize sidebar position
- 🎨 **Modern UI**: Clean, responsive interface that works on desktop and mobile

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the root directory with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```
   Content moderation is on by default; set `MODERATION_ENABLED=false` to turn it off.
   CVE enrichment is on by default; set `CVE_LOOKUP_ENABLED=false` to turn it off (`CVE_LOOKUP_TIMEOUT_MS` sets the per-lookup timeout, default 3000).

## Usage

### Standard Setup
1. Start the server:
   ```
   npm start
   ```
   For development with auto-reload:
   ```
   npm run dev
   ```
   
   You'll see your local network IP displayed in the console for accessing from other devices.

### WSL Setup (Windows Subsystem for Linux)
If you're running this application in WSL on Windows, follow these additional steps to make it accessible from other devices on your network:

1. **Find your Windows IP address** (not the WSL IP):
   - Open PowerShell or Command Prompt in Windows
   - Run `ipconfig` and look for your Windows IP (typically under "Wireless LAN adapter Wi-Fi" or "Ethernet adapter")
   - Note the IPv4 Address (e.g., 192.168.1.xxx)

2. **Port forwarding from Windows to WSL**:
   - Open PowerShell as Administrator
   - Set up port forwarding:
     ```
     netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=$(wsl hostname -I | awk '{print $1}')
     ```
   - To verify it's set up correctly:
     ```
     netsh interface portproxy show all
     ```
   - You may need to allow the port through Windows Firewall:
     ```
     New-NetFirewallRule -DisplayName "WSL AIchatbot" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001
     ```

3. **Setting up a custom domain name (optional)**:

   #### Option 1: Using local hosts file (for just a few devices):
   - On each device that will access the chatbot, edit the hosts file:
     - Windows: `C:\Windows\System32\drivers\etc\hosts`
     - Mac/Linux: `/etc/hosts`
   - Add this line to the file (replace with your Windows IP):
     ```
     192.168.1.xxx cb.local
     ```
   - After saving, you can access the chatbot using:
     ```
     http://cb.local:3001
     ```

   #### Option 2: Using mDNS for automatic discovery (Windows host):
   - Install Bonjour Print Services on your Windows host:
     - Download from [Apple Support](https://support.apple.com/kb/DL999)
     - Or install iTunes which includes Bonjour
   - Create a mDNS advertisement by installing [Bonjour SDK](https://developer.apple.com/bonjour/)
     and using the command line tool `dns-sd` to advertise the service:
     ```
     dns-sd -R "ChatBot" _http._tcp local 3001
     ```
   - Alternatively, use Node.js with a module like `bonjour`:
     ```
     npm install bonjour
     ```
   - Then create a script `advertise.js`:
     ```javascript
     const bonjour = require('bonjour')()
     bonjour.publish({
       name: 'ChatBot',
       type: 'http',
       port: 3001
     })
     console.log('ChatBot service advertised via mDNS')
     ```
   - Run it with `node advertise.js`
   - Now other devices can access using `http://chatbot.local:3001`

4. **Access from other devices**:
   - With hosts file or mDNS: Use `http://cb.local:3001` or your chosen domain
   - Without custom domain: Use `http://WINDOWS-IP:3001` (replace with your actual Windows IP)
   - For example: `http://192.168.1.123:3001`

To remove the port forwarding when no longer needed:
```
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
```
3. Access the application:
   - From your Windows computer: `http://localhost:3001`
   - From other devices: Follow the appropriate instructions above based on your setup
4. Start chatting with the AI!

## File Upload

The chatbot supports uploading the following file types for analysis:
- Text files (.txt)
- Code files (.js, .html, .css, .json, .py, .cpp, .h, .c)
- Documentation (.md)
- Data files (.xml, .yaml, .yml, .sql)
- Log files (.log)

### S3 storage (optional)

By default uploads are stored on local disk in `uploads/`. To store them in Amazon S3 instead, set:

```
S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
# Credentials come from the standard AWS provider chain (AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY, a shared profile, or an instance/task role).
S3_SIGNED_URL_TTL=300   # optional, signed download URL lifetime in seconds
```

With S3 enabled, files are written under the `uploads/` key prefix with SSE-S3 encryption, the public `/uploads` static route is disabled, and `GET /api/files/:name` redirects to a short-lived signed URL that forces a plain-text download. The IAM principal needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::your-bucket-name/uploads/*`. Keep the bucket's Block Public Access settings on.

## Knowledge Base (RAG, optional)

1. Start Qdrant: `QDRANT_API_KEY=<random-secret> docker compose up -d qdrant`. It listens on `127.0.0.1:6333` only.
2. Add to `.env`:
   ```
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=<same secret>
   QDRANT_COLLECTION=knowledge_base   # optional
   KB_TOP_K=4                          # optional, excerpts per question
   KB_MIN_SCORE=0.3                    # optional, cosine similarity cutoff
   ```
3. Ingest documents (`.txt`, `.md`, `.json`, `.yaml`, `.yml`, `.csv`, max 1 MB) with the admin API key:
   ```
   curl -H "X-API-Key: $CHATBOT_API_KEY" -F file=@secure-coding-policy.md -F title="Secure Coding Policy" \
     http://localhost:3001/api/kb/documents
   ```
   - `GET /api/kb/documents`: list ingested documents
   - `DELETE /api/kb/documents/:id`: remove a document and its vectors

Documents are split into roughly 1,000-character chunks and embedded with OpenAI `text-embedding-3-small`. On each chat message, the newest user message is embedded and the closest chunks are added to the prompt as untrusted reference material. `/api/chat` responses include a `sources` array listing the documents used. If Qdrant or the embeddings call fails, chat continues without knowledge-base context.

## Technical Details

- Frontend: HTML, CSS, JavaScript (Vanilla)
- Backend: Node.js, Express
- AI: OpenAI GPT-4 API
- Knowledge base: Qdrant vector database + OpenAI Embeddings API (`text-embedding-3-small`), see `knowledgeBase.js` and `docker-compose.yml`
- Moderation: OpenAI Moderation API (`omni-moderation-latest`), see `moderation.js`
- CVE enrichment: OSV.dev public API (`https://api.osv.dev/v1/vulns/<id>`, no API key), see `cveLookup.js`. Up to 5 CVE IDs from the newest user message are sent to OSV.dev; the server needs outbound HTTPS to `api.osv.dev`
- File Storage: Local file system
- Chat History: JSON files stored in the `data` directory
- Testing: Jest with jsdom for automated testing

## Running Tests

To run the automated tests:

```bash
# Install dependencies if not already done
npm install

# Run all tests
npm test
```

This will run the complete test suite, which includes tests for:
- UI Components
- Message Handling
- Conversation Management
- Collapse Animation

## Directory Structure

- `/data`: Stores conversation history
- `/uploads`: Stores uploaded files
- `index.js`: Main server file
- `moderation.js`: Content moderation service
- `cveLookup.js`: CVE enrichment service (OSV.dev)
- `knowledgeBase.js`: RAG knowledge base (chunking, embeddings, Qdrant)
- `docker-compose.yml`: Qdrant vector database
- `index.html`: Frontend interface
- `style.css`: Styling

## License

ISC
>>>>>>> 0a16cf2b4d7095dd5fec7f51f86f7826d65e65fd
