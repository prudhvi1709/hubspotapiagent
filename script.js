/* globals bootstrap */
import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";
import { getProfile } from "https://aipipe.org/aipipe.js";

// Add styles for the scrollable panels
const style = document.createElement('style');
style.textContent = `
  .scrollable-panel {
    max-height: 80vh;
    overflow-y: auto;
    padding: 10px;
  }
  #results {
    display: flex;
    gap: 20px;
  }
  .conversation-container, .result-container {
    flex: 1;
  }
`;
document.head.appendChild(style);

render(
  html`<button type="submit" class="btn btn-primary w-100">
    <i class="bi bi-arrow-right"></i>
    Submit
  </button>`,
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
    // Only add the asterisk for APIs where token is required
    const requiredAsterisk = (api.name === "GitHub" || api.name === "Stack Overflow" || api.name === "Crossref") ? "" : '<span class="text-danger"> *</span>';
    tokenLabelContainer.innerHTML = `
      <span>${api.tokenLabel}${requiredAsterisk}</span> 
      <a href="${api.tokenHelpUrl}" target="_blank" rel="noopener" id="token-help-url">Get token <i class="bi bi-box-arrow-up-right"></i></a>
    `;
  }

  document.getElementById("api-token").placeholder = api.tokenPlaceholder;
  
  // Set required attribute based on API type
  const tokenInput = document.getElementById("api-token");
  if (api.name === "GitHub" || api.name === "Stack Overflow" || api.name === "Crossref") {
    tokenInput.removeAttribute("required");
  } else {
    tokenInput.setAttribute("required", "required");
  }

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
    "Content-Type": "application/json"
  },
  credentials: "include"
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

  // Check if token is required but not provided
  const tokenInput = document.getElementById("api-token");
  if (currentApi.name !== "GitHub" && currentApi.name !== "Stack Overflow" && currentApi.name !== "Crossref" && !tokenInput.value.trim()) {
    alert(`${currentApi.name} API token is required`);
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
      `https://llmfoundry.straive.com/openai/v1/chat/completions`,
      {
        ...request,
        credentials: "include",
        body: JSON.stringify({
          model: "gpt-4.1-mini",
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
      `https://llmfoundry.straive.com/openai/v1/chat/completions`,
      {
        ...request,
        credentials: "include",
        body: JSON.stringify({
          model: "gpt-4.1-mini",
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
      <div class="row vh-100">
        <div class="col-md-6 h-100 overflow-auto pe-md-0">
          <div class="conversation-container h-100 overflow-auto border-end"></div>
        </div>
        <div class="col-md-6 h-100 overflow-auto ps">
          <div class="result-container h-100 overflow-auto"></div>
        </div>
      </div>
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
    } else if ((name === "result" || name === "error") && developerStepNum !== null) {
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
      resultMessages.push({ stepNum, name, content, markdown });
    } else {
      markdown = content;
      conversationMessages.push({ stepNum, name, content, markdown });
    }
  });
  
  // Build HTML strings for conversation and result containers
  let conversationHTML = '';
  let resultHTML = '';
  
  // Create conversation cards HTML
  conversationMessages.forEach(message => {
    const { stepNum, name, markdown, isTable = false } = message;
    const iconClass = iconMap[name] || "bi-chat-dots";
    
    conversationHTML += `
      <div class="card mb-3 conversation-message" 
           data-step-num="${stepNum}" 
           data-name="${name}" 
           id="conv-step-${stepNum}">
        <div class="card-header ${colorMap[name] || "bg-secondary"} text-white d-flex align-items-center" 
             data-bs-toggle="collapse" 
             data-bs-target="#step-${stepNum}" 
             role="button" 
             aria-expanded="true">
          <i class="bi ${iconClass} me-2"></i>
          <span class="badge bg-light text-dark me-2">${stepNum}</span>
          <strong>${name}</strong>
          <i class="bi bi-chevron-down ms-auto"></i>
        </div>
        <div class="collapse show" id="step-${stepNum}">
          <div class="card-body">${markdown ? marked.parse(markdown) : ''}</div>
        </div>
      </div>
    `;
  });
  
  // Create result cards HTML
  resultMessages.forEach(message => {
    const { stepNum, name, markdown, renderedContent, isTable = false } = message;
    const iconClass = isTable ? "bi-table" : (iconMap[name] || "bi-chat-dots");
    const correspondingDevStep = [...alignmentMap.entries()]
      .find(([devStep, resultStep]) => resultStep === stepNum)?.[0];
    
    resultHTML += `
      <div class="card mb-3 result-message ${isTable ? 'table-result-card' : ''}" 
           data-step-num="${stepNum}" 
           id="result-step-${stepNum}"
           ${correspondingDevStep ? `data-matches-conv-step="${correspondingDevStep}"` : ''}>
        <div class="card-header ${colorMap[name] || "bg-secondary"} text-white d-flex align-items-center" 
             data-bs-toggle="collapse" 
             data-bs-target="#result-${stepNum}" 
             role="button" 
             aria-expanded="true">
          <i class="bi ${iconClass} me-2"></i>
          <span class="badge bg-light text-dark me-2">${stepNum}</span>
          <strong>${isTable ? "Table Results" : name}</strong>
          ${isTable ? `<span class="ms-2 badge bg-light text-dark"><i class="bi bi-grid-3x3"></i> Data table</span>` : ''}
          <i class="bi bi-chevron-down ms-auto"></i>
        </div>
        <div class="collapse show" id="result-${stepNum}">
          <div class="${isTable ? 'card-body p-0 table-responsive' : 'card-body'}">
            ${renderedContent || (markdown ? marked.parse(markdown) : '')}
          </div>
        </div>
      </div>
    `;
  });
  
  // Apply HTML to containers
  conversationContainer.innerHTML = conversationHTML;
  resultContainer.innerHTML = resultHTML;
  
  // Add scroll synchronization
  let isScrolling = false;
  
  conversationContainer.addEventListener('scroll', function() {
    if (isScrolling) return;
    isScrolling = true;
    
    const visibleCards = [...conversationContainer.querySelectorAll('.conversation-message')]
      .filter(card => {
        const rect = card.getBoundingClientRect();
        const containerRect = conversationContainer.getBoundingClientRect();
        return rect.top >= containerRect.top && rect.top <= containerRect.bottom;
      });
    
    if (visibleCards.length > 0) {
      const visibleCard = visibleCards[0];
      const stepNum = visibleCard.dataset.stepNum;
      
      if (visibleCard.dataset.name === 'developer') {
        const matchingResultCard = resultContainer.querySelector(`[data-matches-conv-step="${stepNum}"]`);
        if (matchingResultCard) {
          matchingResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
    
    setTimeout(() => { isScrolling = false; }, 100);
  });
  
  // Add reverse scroll synchronization
  resultContainer.addEventListener('scroll', function() {
    if (isScrolling) return;
    isScrolling = true;
    
    const visibleResultCards = [...resultContainer.querySelectorAll('.result-message')]
      .filter(card => {
        const rect = card.getBoundingClientRect();
        const containerRect = resultContainer.getBoundingClientRect();
        return rect.top >= containerRect.top && rect.top <= containerRect.bottom;
      });
    
    if (visibleResultCards.length > 0) {
      const visibleCard = visibleResultCards[0];
      const matchesConvStep = visibleCard.dataset.matchesConvStep;
      
      if (matchesConvStep) {
        const matchingDevCard = conversationContainer.querySelector(`#conv-step-${matchesConvStep}`);
        if (matchingDevCard) {
          matchingDevCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
    
    setTimeout(() => { isScrolling = false; }, 100);
  });
}

function renderTableFromJSON(jsonArray) {
  if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
    return '<div class="alert alert-warning">No data available</div>';
  }

  // Minimal flatten function
  const flatten = (obj, prefix = '') => {
    return Object.keys(obj).reduce((acc, key) => {
      const prefixedKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          acc[prefixedKey] = JSON.stringify(value);
        } else {
          Object.assign(acc, flatten(value, prefixedKey));
        }
      } else {
        acc[prefixedKey] = value;
      }
      
      return acc;
    }, {});
  };

  // Flatten the data
  const flattenedData = jsonArray.map(item => flatten(item));
  
  // Get all unique keys
  const allKeys = Array.from(
    new Set(flattenedData.flatMap(item => Object.keys(item)))
  ).sort();

  // Use lit-html to render the table
  const tableTemplate = document.createElement('div');
  render(
    html`
      <table class="table table-striped table-hover">
        <thead>
          <tr>
            ${allKeys.map(key => html`<th>${key}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${flattenedData.map(row => html`
            <tr>
              ${allKeys.map(key => html`<td>${row[key] !== undefined ? row[key] : ''}</td>`)}
            </tr>
          `)}
        </tbody>
      </table>
    `,
    tableTemplate
  );
  
  return tableTemplate.innerHTML;
}