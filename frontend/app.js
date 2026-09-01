document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('prompt-form');
  const promptInput = document.getElementById('prompt');
  const results = document.getElementById('results');
  const authPanel = document.getElementById('auth-panel');
  const billingPanel = document.getElementById('billing-panel');
  const projectsList = document.getElementById('projects-list');
  const authForm = document.getElementById('auth-form');
  const authStatus = document.getElementById('auth-status');
  const checkoutForm = document.getElementById('checkout-form');

  let token = localStorage.getItem('xai-token') || '';

  function setAuthStatus(message, isError = false) {
    authStatus.textContent = message;
    authStatus.style.color = isError ? '#fda4af' : '#86efac';
  }

  function authHeaders(extra = {}) {
    const base = { 'Content-Type': 'application/json', ...extra };
    if (token) base['Authorization'] = `Bearer ${token}`;
    return base;
  }

  async function loadProjects() {
    try {
      const response = await fetch('/api/projects', {
        headers: authHeaders()
      });
      if (!response.ok) {
        // show friendly message if unauthorized or other error
        if (response.status === 401) {
          projectsList.innerHTML = '<li>Please sign in to see projects.</li>';
          return;
        }
        throw new Error(`Failed to load projects (${response.status})`);
      }
      const json = await response.json();
      if (!json.projects || !json.projects.length) {
        projectsList.innerHTML = '<li>No projects yet.</li>';
        return;
      }
      projectsList.innerHTML = json.projects.map(project => `
        <li><strong>${project.title}</strong><br>${project.prompt}</li>
      `).join('');
    } catch (error) {
      projectsList.innerHTML = `<li>Unable to load projects: ${error.message}</li>`;
    }
  }

  async function saveProject(project) {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(project)
      });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(txt || 'Failed to save project');
      }
      const json = await response.json();
      if (json.project) {
        await loadProjects();
      }
    } catch (err) {
      results.innerHTML = `<p>Save project failed: ${err.message}</p>`;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();

    results.innerHTML = '<p>Generating your plan...</p>';

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        if (response.status === 401) {
          results.innerHTML = '<p>Unauthorized — please sign in.</p>';
          return;
        }
        const txt = await response.text();
        throw new Error(txt || `Generation failed (${response.status})`);
      }

      const json = await response.json();
      results.innerHTML = `
        <h2>Result</h2>
        <p><strong>Project type:</strong> ${json.projectType}</p>
        <p><strong>Summary:</strong> ${json.summary}</p>
        <pre>${JSON.stringify(json.blueprint, null, 2)}</pre>
      `;

      await saveProject({ title: 'Generated project', prompt, projectType: json.projectType });
    } catch (error) {
      results.innerHTML = `<p>Generation failed: ${error.message}</p>`;
    }
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Registration failed');
      }
      token = json.token;
      localStorage.setItem('xai-token', token);
      setAuthStatus(`Signed in as ${json.user.email}`);
      authPanel.style.display = 'none';
      billingPanel.style.display = 'block';
      // reload projects with token now set
      await loadProjects();
    } catch (error) {
      setAuthStatus(error.message, true);
    }
  });

  checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const planName = document.getElementById('plan').value;

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ planName })
      });

      if (!response.ok) {
        if (response.status === 401) {
          results.innerHTML = '<p>Unauthorized — please sign in.</p>';
          return;
        }
        const txt = await response.text();
        throw new Error(txt || `Checkout failed (${response.status})`);
      }

      const json = await response.json();
      results.innerHTML = `<h2>Checkout created</h2><pre>${JSON.stringify(json.invoice, null, 2)}</pre>`;
    } catch (error) {
      results.innerHTML = `<p>Checkout failed: ${error.message}</p>`;
    }
  });

  if (token) {
    authPanel.style.display = 'none';
    billingPanel.style.display = 'block';
    setAuthStatus('Authenticated');
  }

  loadProjects();
});
