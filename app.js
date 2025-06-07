document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM Element Declarations ---
    const settingsButton = document.getElementById('settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const closeButton = document.querySelector('.close-button');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyButton = document.getElementById('save-api-key-button');
    const apiKeyStatus = document.querySelector('.api-key-status');
    const modelSelector = document.getElementById('model-selector');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatMessages = document.getElementById('chat-messages');
    const newChatButton = document.getElementById('new-chat-button');
    const chatHistoryList = document.getElementById('chat-history-list');
    const menuToggleButton = document.getElementById('menu-toggle-button');
    const sidebar = document.querySelector('.sidebar');
    const appTitle = document.querySelector('.app-header h1');

    // --- 2. State Variables ---
    let openAIApiKey = localStorage.getItem('openai_api_key');
    let activeConversationId = null; // The ID of the chat from OUR database
    let currentResponseId = null;    // The ID from OpenAI for resuming the conversation

    // --- 3. Database Setup (using Dexie.js) ---
    const db = new Dexie('LLMChatDatabase');
    db.version(1).stores({
        conversations: '++id, updatedAt', // Primary key 'id', index 'updatedAt' for sorting
    });

    // --- 4. Function Definitions ---

    function updateApiKeyStatus() {
        if (!apiKeyStatus) return;
        if (openAIApiKey) {
            apiKeyStatus.textContent = 'API Key is set.';
            apiKeyStatus.style.color = 'lightgreen';
        } else {
            apiKeyStatus.textContent = 'API Key is not set. Click ⚙️ to add it.';
            apiKeyStatus.style.color = 'orange';
        }
    }

    function addMessageToUI(sender, text, type = sender, messageId = null, isStreaming = false) {
        if (!chatMessages) return;
        let messageElement = messageId ? document.getElementById(messageId) : null;
        if (messageElement && isStreaming) {
            const paragraph = messageElement.querySelector('p');
            if (paragraph) paragraph.textContent += text;
        } else {
            if (messageElement) messageElement.remove();
            messageElement = document.createElement('div');
            messageElement.classList.add('message', type);
            if (messageId) messageElement.id = messageId;
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            messageElement.appendChild(paragraph);
            chatMessages.appendChild(messageElement);
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    async function renderChatHistory() {
        if (!chatHistoryList) return;
        const conversations = await db.conversations.orderBy('updatedAt').reverse().toArray();
        chatHistoryList.innerHTML = '';
        conversations.forEach(convo => {
            const item = document.createElement('button');
            item.className = 'chat-history-item';
            item.textContent = convo.title;
            item.dataset.id = convo.id;
            if (convo.id === activeConversationId) {
                item.classList.add('active');
            }
            item.onclick = () => loadConversation(convo.id);
            chatHistoryList.appendChild(item);
        });
    }

    async function loadConversation(id) {
        console.log(`Loading conversation with ID: ${id}`);
        const convo = await db.conversations.get(id);
        if (!convo) { return startNewChat(); }
        
        chatMessages.innerHTML = '';
        convo.messages.forEach(msg => {
            addMessageToUI(msg.sender, msg.text, msg.type);
        });
        
        activeConversationId = convo.id;
        currentResponseId = convo.openAIResponseId;

        console.log(`Loaded state: activeConvo=${activeConversationId}, openAIResponseId=${currentResponseId}`);
        renderChatHistory();
        if (sidebar?.classList.contains('open')) sidebar.classList.remove('open');
    }

    function startNewChat() {
        console.log("Starting new chat.");
        chatMessages.innerHTML = '';
        addMessageToUI('system', 'New chat started. Ask me anything!');
        activeConversationId = null;
        currentResponseId = null;
        renderChatHistory();
        messageInput.focus();
        if (sidebar?.classList.contains('open')) sidebar.classList.remove('open');
    }

    async function handleSendMessage() {
        const messageText = messageInput.value.trim();
        if (!messageText) return;
        if (!openAIApiKey) {
            addMessageToUI('system', 'Please set your OpenAI API Key first.', 'error');
            return;
        }

        addMessageToUI('user', messageText);
        
        const userMessage = { sender: 'user', text: messageText, type: 'user' };
        let conversationIdForThisTurn = activeConversationId;
        
        if (!conversationIdForThisTurn) {
            const newConvo = {
                title: messageText.substring(0, 40) + (messageText.length > 40 ? '...' : ''),
                messages: [userMessage],
                openAIResponseId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            conversationIdForThisTurn = await db.conversations.add(newConvo);
            activeConversationId = conversationIdForThisTurn;
            await renderChatHistory();
        } else {
            await db.conversations.update(conversationIdForThisTurn, {
                'messages': Dexie.modify(msgs => msgs.push(userMessage)),
                'updatedAt': new Date(),
            });
        }
        
        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendButton.disabled = true;
        const thinkingId = `thinking-${Date.now()}`;
        addMessageToUI('assistant', 'Thinking...', 'assistant-thinking', thinkingId);

        const requestBody = { model: modelSelector.value, instructions: "You are a helpful assistant.", stream: true, input: messageText };
        if (currentResponseId) requestBody.previous_response_id = currentResponseId;
        else requestBody.store = true;

        let streamedResponseText = "";
        let newResponseIdFromServer = null;
        
        try {
            const response = await fetch("http://localhost:3000/api/responses", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody)
            });
            if (!response.ok) throw new Error((await response.json()).error.message);

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let assistantMessageId = `assistant-msg-${Date.now()}`;
            let firstChunkReceived = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const eventBoundary = '\n\n';
                let boundaryIndex;
                while ((boundaryIndex = buffer.indexOf(eventBoundary)) !== -1) {
                    const eventString = buffer.substring(0, boundaryIndex);
                    buffer = buffer.substring(boundaryIndex + eventBoundary.length);
                    const dataLine = eventString.split('\n').find(line => line.startsWith('data:'));
                    if (dataLine) {
                        const jsonStr = dataLine.substring(5).trim();
                        if (jsonStr === "[DONE]") continue;
                        try {
                            const event = JSON.parse(jsonStr);
                            if (event.response_id) newResponseIdFromServer = event.response_id;
                            if (event.type === "response.output_text.delta") {
                                const textDelta = event.delta || "";
                                if (textDelta) {
                                    if (!firstChunkReceived) {
                                        document.getElementById(thinkingId)?.remove();
                                        addMessageToUI('assistant', textDelta, 'assistant', assistantMessageId, true);
                                        firstChunkReceived = true;
                                    } else {
                                        addMessageToUI('assistant', textDelta, 'assistant', assistantMessageId, true);
                                    }
                                    streamedResponseText += textDelta;
                                }
                            }
                        } catch (e) { console.warn("Could not parse event data as JSON:", jsonStr, e); }
                    }
                }
            }
            if (!firstChunkReceived) document.getElementById(thinkingId)?.remove();
        } catch (error) {
            document.getElementById(thinkingId)?.remove();
            addMessageToUI('system', `Error: ${error.message}`, 'error');
        } finally {
            sendButton.disabled = false;
            if (streamedResponseText) {
                currentResponseId = newResponseIdFromServer;
                await db.conversations.update(conversationIdForThisTurn, {
                    'messages': Dexie.modify(msgs => msgs.push({ sender: 'assistant', text: streamedResponseText, type: 'assistant' })),
                    'openAIResponseId': currentResponseId,
                    'updatedAt': new Date(),
                });
                await renderChatHistory();
            }
        }
    }

    // --- 5. Event Listener Attachments ---
    // This block is now clean and attaches all listeners safely.
    if(sendButton) sendButton.addEventListener('click', handleSendMessage);
    if(messageInput) {
        messageInput.addEventListener('keypress', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSendMessage(); } });
        messageInput.addEventListener('input', () => { messageInput.style.height = 'auto'; messageInput.style.height = (messageInput.scrollHeight) + 'px'; });
    }
    if(newChatButton) newChatButton.addEventListener('click', startNewChat);
    if(menuToggleButton && sidebar) menuToggleButton.addEventListener('click', () => sidebar.classList.toggle('open'));
    if (settingsButton && settingsModal && closeButton && saveApiKeyButton && apiKeyInput) {
        settingsButton.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
            apiKeyInput.value = openAIApiKey || '';
            updateApiKeyStatus();
        });
        closeButton.addEventListener('click', () => { settingsModal.style.display = 'none'; });
        window.addEventListener('click', (event) => { if (event.target === settingsModal) settingsModal.style.display = 'none'; });
        saveApiKeyButton.addEventListener('click', () => {
            openAIApiKey = apiKeyInput.value.trim();
            if (openAIApiKey) { localStorage.setItem('openai_api_key', openAIApiKey); }
            else { localStorage.removeItem('openai_api_key'); }
            updateApiKeyStatus();
            setTimeout(() => { if (openAIApiKey) settingsModal.style.display = 'none'; }, 1000);
        });
    }

    // --- 6. Initial App Load ---
    updateApiKeyStatus();
    renderChatHistory();
    startNewChat();
});