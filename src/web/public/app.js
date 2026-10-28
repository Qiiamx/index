function addFolderOption(select, folder) {
  if (!select || !folder) return;
  let option = Array.from(select.options).find((item) => item.value === folder.id);
  if (!option) {
    option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.label || folder.name;
    select.appendChild(option);
  }
  select.value = folder.id;
}

let activeTagForm = null;

function indexRememberTagTarget(button) {
  activeTagForm = button?.closest('form') ?? null;
}

function addTagCheckbox(container, tag) {
  if (!container || !tag) return;
  let label = container.querySelector(`input[value="${tag.id}"]`)?.closest('label');
  if (!label) {
    label = document.createElement('label');
    label.className = 'checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'tags';
    input.value = tag.id;
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${tag.label || tag.name}`));
    container.appendChild(label);
  }
  const input = label.querySelector('input');
  if (input) input.checked = true;
}

document.body.addEventListener('quickFolderCreated', (event) => {
  const detail = event.detail || {};
  const folders = Array.isArray(detail.folders) ? detail.folders : [detail];
  const target = document.querySelector('select[name="targetFolderId"]');
  const parent = document.querySelector('select[name="parentId"]');
  folders.forEach((folder) => {
    addFolderOption(target, folder);
    addFolderOption(parent, folder);
  });
  if (detail.leafId && target) target.value = detail.leafId;
  document.getElementById('quick-dialog')?.close();
});

document.body.addEventListener('quickTagCreated', (event) => {
  const container = activeTagForm?.querySelector('#folder-tag-options')
    ?? document.querySelector('#folder-tag-options');
  addTagCheckbox(container, event.detail || {});
  document.getElementById('quick-tag-dialog')?.close();
  activeTagForm = null;
});

async function pickLocalFolder() {
  const input = document.getElementById('source-address');
  if (!input) return;
  try {
    const response = await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json();
    if (data.path) {
      input.value = data.path;
    } else if (data.error) {
      alert(data.error);
    }
  } catch (error) {
    alert(`无法打开文件夹选择器：${error.message}`);
  }
}

for (const id of ['quick-dialog', 'quick-tag-dialog']) {
  const dialog = document.getElementById(id);
  if (!dialog) continue;
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
