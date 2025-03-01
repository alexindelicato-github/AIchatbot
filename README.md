# AI Security Chatbot

An enhanced AI chatbot with chat history persistence and file upload capabilities, powered by OpenAI's GPT-4.

## Features

- 💬 **Chat with GPT-4**: Interact with a sophisticated AI trained to provide cybersecurity assistance
- 📁 **File Upload**: Upload code files, configurations, or any text files for AI analysis
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

## Technical Details

- Frontend: HTML, CSS, JavaScript (Vanilla)
- Backend: Node.js, Express
- AI: OpenAI GPT-4 API
- File Storage: Local file system
- Chat History: JSON files stored in the `data` directory

## Directory Structure

- `/data`: Stores conversation history
- `/uploads`: Stores uploaded files
- `index.js`: Main server file
- `index.html`: Frontend interface
- `style.css`: Styling

## License

ISC
