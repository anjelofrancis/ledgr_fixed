// LEDGR Guide Bot (Powered by Gemini)

let conversationHistory = [];

function openBot() {
  document.getElementById('botPanel').classList.add('open');
  const overlay = document.getElementById('botOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeBot() {
  document.getElementById('botPanel').classList.remove('open');
  const overlay = document.getElementById('botOverlay');
  if (overlay) overlay.classList.remove('open');
}

function addBotMessage(text, role = 'bot') {
  const container = document.getElementById('botMessages');
  const div = document.createElement('div');
  div.className = `bot-msg ${role}`;
  // Convert basic markdown to HTML for bot messages
  if (role === 'bot') {
    let html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    div.innerHTML = html;
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById('botMessages');
  const div = document.createElement('div');
  div.className = `bot-msg bot typing-indicator`;
  div.id = 'botTyping';
  div.innerHTML = '<span>.</span><span>.</span><span>.</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('botTyping');
  if (el) el.remove();
}

async function sendBotMsg(customText = null) {
  const input = document.getElementById('botInput');
  const text = customText !== null ? customText : input.value.trim();
  
  if (!text) return;
  
  // Only show the user message in the UI if it wasn't a hidden tour trigger
  if (customText === null) {
    addBotMessage(text, 'user');
    input.value = '';
  }
  
  // Add to history
  conversationHistory.push({ role: 'user', text: text });
  
  // Clear any existing options
  const optionsContainer = document.getElementById('botOptions');
  if (optionsContainer) optionsContainer.innerHTML = '';

  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });
    
    const data = await res.json();
    hideTyping();
    
    if (data.response) {
      addBotMessage(data.response, 'bot');
      conversationHistory.push({ role: 'bot', text: data.response });
    } else {
      addBotMessage("Sorry, I encountered an error connecting to the server.", 'bot');
    }
  } catch (err) {
    console.error('Chat error:', err);
    hideTyping();
    addBotMessage("Sorry, I couldn't reach the server. Please try again later.", 'bot');
  }
}

// Special function for the "Take the tour" button
function startTour() {
  openBot();
  // Clear history to start fresh
  conversationHistory = [];
  const container = document.getElementById('botMessages');
  container.innerHTML = `<div class="bot-msg bot">
    👋 Welcome to <strong>LEDGR</strong>! I'm your guide. I'll walk you through what this platform can do for your business.
  </div>`;
  
  // Automatically trigger a prompt to Gemini to start the tour
  sendBotMsg("I'd like to take a tour of LEDGR. Please explain the 3 most important features briefly and ask what I want to learn more about.");
}

// ── Attach all event listeners (CSP blocks inline onclick handlers) ──────────
document.addEventListener('DOMContentLoaded', () => {
  // Bot trigger button (landing page: starts tour, dashboard: just opens)
  const trigger = document.getElementById('botTrigger');
  if (trigger) {
    // Landing page trigger starts the tour; dashboard trigger just opens the panel
    const isLanding = document.body.classList.contains('landing-body');
    trigger.addEventListener('click', () => {
      if (isLanding) {
        startTour();
      } else {
        openBot();
      }
    });
  }

  // Overlay click to close
  const overlay = document.getElementById('botOverlay');
  if (overlay) {
    overlay.addEventListener('click', () => closeBot());
  }

  // Close button
  const closeBtn = document.getElementById('botCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeBot());
  }

  // Send button
  const sendBtn = document.getElementById('botSendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendBotMsg());
  }

  // Enter key on input
  const botInput = document.getElementById('botInput');
  if (botInput) {
    botInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendBotMsg();
    });
  }
});
