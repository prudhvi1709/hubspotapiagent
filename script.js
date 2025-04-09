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
    ? html`<button type="submit" class="btn btn-primary w-100 mt-3">
        <i class="bi bi-arrow-right"></i>
        Submit
      </button>`
    : html`<a class="btn btn-primary w-100 mt-3" href="${url}">Log in to try your own contracts</a></p>`,
  document.querySelector("#submit-task")
);

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
  const task = e.target.task.value;
  const messages = [{ role: "user", name: "user", content: task }];

  for (let attempt = 0; attempt < 3; attempt++) {
    const llmMessages = [...messages];
    let message = { role: "assistant", name: "developer", content: "" };
    messages.push(message);
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
              content: `You are a HubSpot API expert. The chat transcript begins with a user provided task.

First, think step-by-step about how to solve the task using HubSpot API requests:

- List all relevant HubSpot API endpoints
- List all relevant input query parameters of each endpoint
- List all relevant output parameters of each endpoint
- List all relevant values from the output parameters that'll complete the task AND help the user validate the result.

When a user asks a question, make sure to retrieve all relevant information to make your output meaningful and comprehensive. Don't assume the user knows all the technical details - provide context and explanations.

Pick the approach MOST suited for the task (efficient, easy to implement, simple).

Solve it by writing JS code like this:

\`\`\`js
export async function run(params) {
  const { HUBSPOT_TOKEN } = params;
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot API token is required");
  }
  
  // CORRECT PATTERN FOR USING STRAIVE PROXY WITH HUBSPOT API:
  // When sending requests to HubSpot APIs, use this pattern:
  
  try {
    // Example GET request with proxy:
    const response = await fetch(\`https://llmfoundry.straive.com/-/proxy/https://api.hubapi.com/crm/v3/objects/contacts\`, {
      headers: {
        'Authorization': \`Bearer \${HUBSPOT_TOKEN}\`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(\`HubSpot API error: \${response.status} \${JSON.stringify(errorData)}\`);
    }
    
    const data = await response.json();
    
    // Example POST request with proxy:
    // const searchResponse = await fetch(\`https://llmfoundry.straive.com/-/proxy/https://api.hubapi.com/crm/v3/objects/deals/search\`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': \`Bearer \${HUBSPOT_TOKEN}\`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     filterGroups: [{ filters: [{ propertyName: "amount", operator: "GT", value: 10000 }] }],
    //     sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    //     limit: 100
    //   })
    // });
    
    // Example HubSpot API patterns:
    // - Search: https://api.hubapi.com/crm/v3/objects/deals/search
    // - Batch associations: https://api.hubapi.com/crm/v3/associations/deal/company/batch/read
    // - Batch read: https://api.hubapi.com/crm/v3/objects/companies/batch/read
    
    // Your code here...
    
    return data; // Return the processed data
  } catch (error) {
    return {
      error: true,
      message: error.message
    };
  }
}
\`\`\`

The user will call result = await run({HUBSPOT_TOKEN}) and share the result (or error).

IMPORTANT: 
1. Always use the correct proxy pattern: \`https://llmfoundry.straive.com/-/proxy/https://api.hubapi.com/...\`
2. Always include the 'Authorization' header with 'Bearer HUBSPOT_TOKEN' for all requests
3. Always check if the response is ok and handle errors properly
4. Always use try/catch blocks to handle any unexpected errors
5. Donot Use Limit, retreive all results.`
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
    const code = [...message.content.matchAll(/```js(.*?)```/gs)][0][1];
    const blob = new Blob([code], { type: "text/javascript" });
    const module = await import(URL.createObjectURL(blob));
    messages.push({ role: "user", name: "result", content: "Running code..." });
    renderSteps(messages);
    try {
      const result = await module.run({
        HUBSPOT_TOKEN: document.getElementById("hubspot-token")?.value || "",
      });
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
              content: `The user provided a task related to HubSpot API. An assistant generated code. The user ran it. These are provided to you.

Check if the code:
1. Used the correct proxy pattern: https://llmfoundry.straive.com/-/proxy/https://api.hubapi.com/...
2. Included proper Authorization headers with Bearer token
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
  render(
    steps.map(({ name, content }, i) => {
      const stepNum = i + 1;
      let markdown =
        name == "result"
          ? "```json\n" + content + "\n```"
          : name == "error"
          ? "```\n" + content + "\n```"
          : content;
      return html`
        <div class="card mb-3">
          <div
            class="card-header ${colorMap[name] ||
            "bg-secondary"} text-white d-flex align-items-center"
            data-bs-toggle="collapse"
            data-bs-target="#step-${stepNum}"
            role="button"
            aria-expanded="true"
          >
            <i class="bi ${iconMap[name] || "bi-chat-dots"} me-2"></i>
            <span class="badge bg-light text-dark me-2">${stepNum}</span>
            <strong>${name}</strong>
            <i class="bi bi-chevron-down ms-auto"></i>
          </div>
          <div class="collapse show" id="step-${stepNum}">
            <div class="card-body">${unsafeHTML(marked.parse(markdown))}</div>
          </div>
        </div>
      `;
    }),
    $results
  );
}

// Add event listeners to example questions
document.querySelectorAll(".example-question").forEach((button) => {
  button.addEventListener("click", () => {
    const task = button.textContent;
    document.querySelector("#task").value = task;
    $taskForm.dispatchEvent(new Event("submit"));
  });
});
