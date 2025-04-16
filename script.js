/* globals bootstrap */
import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";

// Log in to LLMFoundry
const LLMFOUNDRY = "https://llmfoundry.straive.com";
const { token } = await fetch(`${LLMFOUNDRY}/token`, {
  credentials: "include",
}).then((res) => res.json());
const url =
  `${LLMFOUNDRY}/login?` + new URLSearchParams({ next: location.href });
render(
  token
    ? html`<button type="submit" class="btn btn-primary w-100">
        <i class="bi bi-arrow-right"></i>
        Submit
      </button>`
    : html`<a class="btn btn-primary w-100" href="${url}">Log in to try your own queries</a></p>`,
  document.querySelector("#submit-task")
);

// Load config.json
let config;
try {
  config = await fetch("config.json").then((res) => res.json());
} catch (error) {
  console.error("Failed to load config:", error);
  config = { apis: [] };
}

// Render API cards
const apiCardsContainer = document.getElementById("api-cards");
const selectedApiDetails = document.getElementById("api-details");
const questionList = document.getElementById("question-list");
let currentApi = null;

render(
  config.apis.map((api) => {
    // Identify the "user" card (you can use api.role === "user" or similar)
    const isUser = api.role === "user";
    const colClass = isUser ? "col center-vertically" : "col";

    return html`
      <div class="${colClass}">
        <div class="card api-card h-100 text-center" @click=${() => selectApi(api)}>
          <div class="card-body">
            <div class="api-icon">
              <i class="bi bi-${api.icon}"></i>
            </div>
            <h5 class="card-title">${api.name}</h5>
            <p class="card-text">
              Query ${api.name} data with natural language
            </p>
          </div>
        </div>
      </div>
    `;
  }),
  apiCardsContainer
);


// Function to select an API
function selectApi(api) {
  currentApi = api;
  document.getElementById("selected-api-name").textContent = api.name;

  // Set API description
  document.getElementById(
    "api-description"
  ).textContent = `${api.name} API Agent lets you interact with your ${api.name} data through simple natural language questions. No need to write complex API calls or understand ${api.name}'s API structure.`;

  // Rebuild the token label section completely
  const tokenLabelContainer = document.getElementById("token-label");
  if (tokenLabelContainer) {
    tokenLabelContainer.innerHTML = `
      <span>${api.tokenLabel}<span class="text-danger"> *</span></span> 
      <a href="${api.tokenHelpUrl}" target="_blank" rel="noopener" id="token-help-url">Get token <i class="bi bi-box-arrow-up-right"></i></a>
    `;
  }

  document.getElementById("api-token").placeholder = api.tokenPlaceholder;

  // Render questions
  render(
    api.questions.map(
      (question) => html`
        <button
          type="button"
          class="list-group-item list-group-item-action example-question"
        >
          ${question}
        </button>
      `
    ),
    questionList
  );

  // Show API details
  selectedApiDetails.style.display = "block";

  // Add event listeners to example questions
  document.querySelectorAll(".example-question").forEach((button) => {
    button.addEventListener("click", () => {
      const task = button.textContent.trim();
      document.querySelector("#task").value = task;
      $taskForm.dispatchEvent(new Event("submit"));
    });
  });

  // Scroll to API details
  selectedApiDetails.scrollIntoView({ behavior: "smooth" });
}

const request = {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
};

const marked = new Marked();
marked.use({
  renderer: {
    table(header, body) {
      return `<table class="table table-sm">${header}${body}</table>`;
    },
    code(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return /* html */ `<pre class="hljs language-${language}"><code>${hljs
        .highlight(code, { language })
        .value.trim()}</code></pre>`;
    },
  },
});

const $taskForm = document.querySelector("#task-form");
const $results = document.querySelector("#results");

$taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentApi) {
    alert("Please select an API first");
    return;
  }

  const task = e.target.task.value;
  const messages = [{ role: "user", name: "user", content: task }];

  for (let attempt = 0; attempt < 3; attempt++) {
    const llmMessages = [...messages];
    let message = { role: "assistant", name: "developer", content: "" };
    messages.push(message);

    // Get token type based on the API
    const tokenParamName = `${currentApi.name
      .toUpperCase()
      .replace(/ /g, "_")}_TOKEN`;

    for await (const { content } of asyncLLM(
      `${LLMFOUNDRY}/openai/v1/chat/completions`,
      {
        ...request,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          stream: true,
          messages: [
            {
              role: "system",
              content: currentApi.systemPrompt,
            },
            ...llmMessages,
          ],
        }),
      }
    )) {
      message.content = content;
      if (content) renderSteps(messages);
    }

    if (message.content && message.content.includes("🟢")) {
      renderSteps(messages);
      return;
    }

    // Extract the code inside ```js in the last step
    const codeMatches = [...message.content.matchAll(/```js(.*?)```/gs)];
    if (codeMatches.length === 0) {
      continue;
    }

    const code = codeMatches[0][1];
    const blob = new Blob([code], { type: "text/javascript" });
    const module = await import(URL.createObjectURL(blob));
    messages.push({ role: "user", name: "result", content: "Running code..." });
    renderSteps(messages);

    try {
      // Create params object with the appropriate token
      const params = {};
      params[tokenParamName] =
        document.getElementById("api-token")?.value || "";

      const result = await module.run(params);
      messages.at(-1).content = JSON.stringify(result, null, 2);
    } catch (error) {
      messages.at(-1).name = "error";
      messages.at(-1).content = error.stack;
    }
    renderSteps(messages);

    const validationMessages = [
      messages.at(0),
      messages.at(-2),
      messages.at(-1),
    ];
    let validationMessage = {
      role: "assistant",
      name: "validator",
      content: "",
    };
    messages.push(validationMessage);
    for await (const { content } of asyncLLM(
      `${LLMFOUNDRY}/openai/v1/chat/completions`,
      {
        ...request,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          stream: true,
          messages: [
            {
              role: "system",
              content: `The user provided a task related to ${currentApi.name} API. An assistant generated code. The user ran it. These are provided to you.

Check if the code:
1. Used the correct proxy pattern: https://llmfoundry.straive.com/-/proxy/...
2. Included proper Authorization headers with the correct token format
3. Properly handled errors and HTTP status codes
4. Successfully completed the requested task

If completely done, say "🟢 DONE". Else JUST explain what is wrong.`,
            },
            ...validationMessages,
          ],
        }),
      }
    )) {
      validationMessage.content = content;
      if (content) renderSteps(messages);
    }
    if (
      validationMessage &&
      validationMessage.content &&
      validationMessage.content.includes("🟢")
    )
      return;
  }
});

// Define icon and color based on name
const iconMap = {
  user: "bi-person-fill",
  developer: "bi-code-square",
  result: "bi-clipboard-data",
  error: "bi-exclamation-triangle",
  validator: "bi-check-circle",
};

const colorMap = {
  user: "bg-primary",
  developer: "bg-success",
  result: "bg-info",
  error: "bg-danger",
  validator: "bg-warning",
};

function renderSteps(steps) {
  // Clear existing content and create containers if they don't exist
  if (!document.querySelector('.conversation-container')) {
    $results.innerHTML = `
      <div class="conversation-container"></div>
      <div class="result-container"></div>
    `;
  }
  
  const conversationContainer = document.querySelector('.conversation-container');
  const resultContainer = document.querySelector('.result-container');
  
  // Clear existing content
  conversationContainer.innerHTML = '';
  resultContainer.innerHTML = '';
  
  // Create a mapping of step numbers to determine which result should align with which conversation step
  const alignmentMap = new Map();
  let developerStepNum = null;
  
  // First pass to identify developer-result pairs
  steps.forEach((step, i) => {
    const { name } = step;
    const stepNum = i + 1;
    
    if (name === "developer") {
      developerStepNum = stepNum;
    } else if (name === "result" && developerStepNum !== null) {
      alignmentMap.set(developerStepNum, stepNum);
      developerStepNum = null;
    }
  });
  
  // Group messages by type (conversation vs result)
  const conversationMessages = [];
  const resultMessages = [];
  
  steps.forEach((step, i) => {
    const { name, content } = step;
    const stepNum = i + 1;
    let markdown;
    let renderedContent;
    let isTable = false;
    
    if (name === "result") {
      try {
        // Try to parse the content as JSON and render as table
        const jsonData = JSON.parse(content);
        if (Array.isArray(jsonData)) {
          // Direct array case
          renderedContent = renderTableFromJSON(jsonData);
          isTable = true;
        } else if (typeof jsonData === 'object' && jsonData !== null) {
          // Look for arrays in the top-level properties
          const arrayProps = Object.entries(jsonData)
            .filter(([_, value]) => Array.isArray(value) && value.length > 0);
          
          if (arrayProps.length > 0) {
            // Use the first array property found
            const [propName, arrayData] = arrayProps[0];
            renderedContent = `<h5>Property: ${propName}</h5>` + renderTableFromJSON(arrayData);
            isTable = true;
          } else {
            // Convert object to a single-row table if it has no array properties
            renderedContent = renderTableFromJSON([jsonData]);
            isTable = true;
          }
        } else {
          markdown = "```json\n" + content + "\n```";
        }
      } catch (e) {
        // If parsing fails, display as before
        markdown = "```json\n" + content + "\n```";
      }
      
      resultMessages.push({ stepNum, name, content, markdown, renderedContent, isTable });
    } else if (name === "error") {
      markdown = "```\n" + content + "\n```";
      conversationMessages.push({ stepNum, name, content, markdown });
    } else {
      markdown = content;
      conversationMessages.push({ stepNum, name, content, markdown });
    }
  });
  
  // Helper function to create card elements
  function createCard({ stepNum, name, markdown, renderedContent, isTable, alignsWith }) {
    const cardElement = document.createElement('div');
    const isResult = Boolean(renderedContent) || name === 'result';
    
    cardElement.className = `card mb-3 ${isResult ? 'result-message' : 'conversation-message'} ${isTable ? 'table-result-card' : ''}`;
    cardElement.dataset.stepNum = stepNum;
    if (alignsWith) cardElement.dataset.alignsWith = alignsWith;
    if (!isResult) cardElement.dataset.name = name;
    
    // Create card header
    const cardHeader = document.createElement('div');
    cardHeader.className = `card-header ${colorMap[name] || "bg-secondary"} text-white d-flex align-items-center`;
    cardHeader.setAttribute('data-bs-toggle', 'collapse');
    cardHeader.setAttribute('data-bs-target', `#${isResult ? 'result' : 'step'}-${stepNum}`);
    cardHeader.setAttribute('role', 'button');
    cardHeader.setAttribute('aria-expanded', 'true');
    
    // Add icon, badge, name and chevron
    const iconClass = isTable ? "bi-table" : (iconMap[name] || "bi-chat-dots");
    cardHeader.innerHTML = `
      <i class="bi ${iconClass} me-2"></i>
      <span class="badge bg-light text-dark me-2">${stepNum}</span>
      <strong>${isTable ? "Table Results" : name}</strong>
      ${isTable ? `<span class="ms-2 badge bg-light text-dark"><i class="bi bi-grid-3x3"></i> Data table</span>` : ''}
      <i class="bi bi-chevron-down ms-auto"></i>
    `;
    
    cardElement.appendChild(cardHeader);
    
    // Create collapse container with card body
    const collapseId = `${isResult ? 'result' : 'step'}-${stepNum}`;
    const bodyClass = `card-body ${isTable ? 'p-0 table-responsive' : ''}`;
    
    const bodyContent = renderedContent || (markdown ? marked.parse(markdown) : '');
    
    cardElement.innerHTML += `
      <div class="collapse show" id="${collapseId}">
        <div class="${bodyClass}">${bodyContent}</div>
      </div>
    `;
    
    return cardElement;
  }
  
  // Render conversation messages
  conversationMessages.forEach(message => {
    const card = createCard(message);
    conversationContainer.appendChild(card);
    
    // Add spacer if needed
    if (message.name === "developer" && !alignmentMap.has(message.stepNum)) {
      const spacer = document.createElement('div');
      spacer.className = 'result-spacer';
      spacer.dataset.alignsWithStep = message.stepNum;
      resultContainer.appendChild(spacer);
    }
  });
  
  // Create a map to track which dev steps have corresponding results
  const resultStepMap = new Map(resultMessages.map(msg => [msg.stepNum, msg]));
  
  // Render result messages with proper alignment
  Array.from(alignmentMap.entries()).forEach(([devStepNum, resultStepNum]) => {
    if (resultStepMap.has(resultStepNum)) {
      const resultMsg = resultStepMap.get(resultStepNum);
      const card = createCard({...resultMsg, alignsWith: devStepNum});
      resultContainer.appendChild(card);
    }
  });
  
  // Set up scroll synchronization
  setupScrollSync();
}

// Function to handle scroll synchronization
function setupScrollSync() {
  const conversationContainer = document.querySelector('.conversation-container');
  const resultContainer = document.querySelector('.result-container');
  
  if (!conversationContainer || !resultContainer) return;
  
  // Create an intersection observer to detect when developer cards become visible
  const options = {
    root: conversationContainer,
    threshold: 0.5
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.target.dataset.name === 'developer') {
        // Find the step number
        const stepNum = entry.target.dataset.stepNum;
        // Find the corresponding result that aligns with this developer step
        const resultMessage = resultContainer.querySelector(`.result-message[data-aligns-with="${stepNum}"]`);
        
        if (resultMessage) {
          resultMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  }, options);
  
  // Observe all developer cards
  document.querySelectorAll('.conversation-message[data-name="developer"]').forEach(card => {
    observer.observe(card);
  });
}

function renderTableFromJSON(jsonArray) {
  if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
    return '<div class="alert alert-warning">No data available</div>';
  }

  // Flatten JSON objects recursively
  function flattenObject(obj, prefix = '') {
    return Object.keys(obj).reduce((acc, key) => {
      const prefixedKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (Array.isArray(obj[key])) {
          // Handle arrays - convert to string
          acc[prefixedKey] = JSON.stringify(obj[key]);
        } else {
          // Recursively flatten nested objects
          Object.assign(acc, flattenObject(obj[key], prefixedKey));
        }
      } else {
        acc[prefixedKey] = obj[key];
      }
      
      return acc;
    }, {});
  }

  // Flatten all objects and collect unique keys
  const flattenedData = jsonArray.map(item => flattenObject(item));
  const allKeys = Array.from(
    new Set(flattenedData.flatMap(item => Object.keys(item)))
  ).sort();

  // Generate table HTML
  let table = '<table class="table table-striped table-hover">\n';
  
  // Table header
  table += '<thead>\n<tr>\n';
  allKeys.forEach(key => {
    table += `<th>${key}</th>\n`;
  });
  table += '</tr>\n</thead>\n';
  
  // Table body
  table += '<tbody>\n';
  flattenedData.forEach(row => {
    table += '<tr>\n';
    allKeys.forEach(key => {
      const value = row[key] !== undefined ? row[key] : '';
      table += `<td>${value}</td>\n`;
    });
    table += '</tr>\n';
  });
  table += '</tbody>\n';
  table += '</table>';
  
  return table;
}
