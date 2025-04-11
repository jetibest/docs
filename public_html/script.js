// script.js

// TODO: fix lingering markdown editor when navigating to another directory
// TODO: fix detecting login/logout state correctly upon page load
// TODO: fix hide editing tools when logged out
// TODO: add functionality to API to allow viewing list of tokens (but only the first hash part), and adding a new random token shown only once, and removing a token, granted that you're authenticated already

// Global state
let currentPath = "";
let isEditing = false;
let editor = null;
let originalContent = "";
let unsavedChanges = false;
const converter = new showdown.Converter();
const authTokenKey = "docsAuthToken";

// When the page loads, check the hash for navigation,
// initialize the sidebar and content view, and update authentication UI.
document.addEventListener("DOMContentLoaded", function () {
  if (window.location.hash) {
    currentPath = decodeURIComponent(window.location.hash.slice(1));
  }
  updateBreadcrumbs(currentPath);
  loadFullSidebar();
  updateContentView();
  updateAuthUI();
});

// -------------------------
// Authentication Functions
// -------------------------

function updateAuthUI() {
  const token = localStorage.getItem(authTokenKey);
  if (token) {
    document.getElementById("auth-status").textContent = "Logged in";
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("logoutBtn").style.display = "inline-block";
  } else {
    document.getElementById("auth-status").textContent = "Not logged in";
    document.getElementById("loginBtn").style.display = "inline-block";
    document.getElementById("logoutBtn").style.display = "none";
  }
}

function doLogin() {
  const token = prompt("Enter your access token:");
  if (token && token.trim() !== "") {
    localStorage.setItem(authTokenKey, token.trim());
    updateAuthUI();
    refreshCurrentView();
  }
}

function doLogout() {
  localStorage.removeItem(authTokenKey);
  updateAuthUI();
  refreshCurrentView();
}

// -------------------------
// Navigation / Unsaved Changes Handling
// -------------------------

// Wrapper for navigation actions; if editing and there are unsaved changes,
// ask for confirmation before navigating away.
function navigateSafely(newPath) {
  if (isEditing && unsavedChanges) {
    if (!confirm("You have unsaved changes. Do you really want to navigate away and discard them?")) {
      return;
    } else {
      cancelEdit();  // Discard unsaved changes
    }
  }
  navigateTo(newPath);
}

function navigateTo(path) {
  // If clicking on a Markdown file, we want to show its parent folder in the sidebar.
  currentPath = path;
  updateBreadcrumbs(currentPath);
  loadFullSidebar();
  updateContentView();
}

function refreshCurrentView() {
  updateBreadcrumbs(currentPath);
  loadFullSidebar();
  updateContentView();
}

// -------------------------
// Breadcrumbs
// -------------------------

function updateBreadcrumbs(path) {
  const crumbs = path.split("/").filter(Boolean);
  let cumulative = "";
  let html = `<a href="#" onclick="navigateSafely('')">Home</a>`;
  crumbs.forEach((crumb) => {
    cumulative += (cumulative ? "/" : "") + crumb;
    html += ` &gt; <a href="#" onclick="navigateSafely('${cumulative}')">${crumb}</a>`;
  });
  document.getElementById("breadcrumbs").innerHTML = html;
  window.location.hash = encodeURIComponent(path);
}

// -------------------------
// Sidebar (Recursive Full Hierarchy)
// -------------------------

// loadFullSidebar fetches the immediate children for the current directory
// (or the parent folder if currentPath is a .md file) and recursively expands
// every level along the current branch.
function loadFullSidebar() {
  // Determine directory to display: if currentPath is a Markdown file,
  // show its parent directory.
  let baseDir = currentPath.endsWith(".md") ?
    currentPath.substring(0, currentPath.lastIndexOf('/')) : currentPath;
  fetchDir(baseDir).then(items => {
    const html = generateSidebarHTML(baseDir, items, baseDir);
    document.getElementById("sidebar").innerHTML = html;
    expandActiveBranch(baseDir);
  }).catch(err => {
    console.error("Error loading sidebar:", err);
    document.getElementById("sidebar").innerHTML = "<p>Error loading sidebar</p>";
  });
}

function fetchDir(dir) {
  return fetch(`/api/dir?path=${encodeURIComponent(dir)}`)
    .then(response => response.json());
}

// generateSidebarHTML creates an unordered list for a given directory.
// Directories are clickable but are not marked active. Only files (Markdown pages)
// are highlighted if they match currentPath.
function generateSidebarHTML(currentDir, items, activeBase) {
  let html = "<ul>";
  items.forEach(item => {
    let fullPath = currentDir ? currentDir + "/" + item.name : item.name;
    let activeClass = "";
    // For files: if fullPath equals currentPath, mark as active.
    if (item.type !== "dir" && fullPath === currentPath) {
      activeClass = "active";
    }
    // ignore/don't show files that are not .md
    if(item.type === 'file' && !item.name.endsWith('.md')) return;
    
    var itemName = item.name;
    if(item.type === 'file')
    {
      itemName = itemName.substring(0, itemName.length - '.md'.length);
    }
    else if(item.type === 'dir')
    {
      itemName += '/';
    }
    // For directories, no active highlight.
    html += `<li class="${activeClass}" onclick="handleSidebarClick('${fullPath}', '${item.type}')">
             ${item.name}
             </li>`;
  });
  html += "</ul>";
  return html;
}

// When a sidebar item is clicked, navigate accordingly.
// For directories, call navigateSafely directly, for files likewise.
function handleSidebarClick(path, type) {
  navigateSafely(path);
}

// Recursively expand the active branch in the sidebar.
// basePath here is the directory whose sidebar is loaded.
function expandActiveBranch(basePath) {
  // If currentPath (or parent of currentPath if a Markdown file) is deeper than basePath,
  // load the next level.
  let target = currentPath;
  if (currentPath.endsWith(".md")) {
    target = currentPath.substring(0, currentPath.lastIndexOf("/"));
  }
  if (!target.startsWith(basePath)) return;
  let relative = target.substring(basePath.length).split("/").filter(Boolean);
  if (relative.length === 0) return; // nothing further to expand
  let nextDir = basePath ? basePath + "/" + relative[0] : relative[0];
  fetchDir(nextDir).then(items => {
    const container = document.createElement("div");
    container.innerHTML = generateSidebarHTML(nextDir, items, target);
    // Append the expanded list inside the appropriate <li> element in the sidebar.
    // Here we search for the <li> whose text starts with the nextDir's last part.
    let sidebarItems = document.getElementById("sidebar").getElementsByTagName("li");
    for (let li of sidebarItems) {
      if (li.textContent.trim().startsWith(relative[0])) {
        li.appendChild(container);
        break;
      }
    }
    // Continue recursively.
    expandActiveBranch(nextDir);
  });
}

// -------------------------
// Main Content Update
// -------------------------

function updateContentView() {
  if (currentPath.endsWith(".md")) {
    loadPage(currentPath);
    document.getElementById("dir-controls").style.display = "none";
    document.getElementById("upload-container").style.display = "none";
  } else {
    document.getElementById("page-view").innerHTML =
      `<p>Select a Markdown (.md) file from the sidebar or create a new page/directory.</p>
       <div id="page-actions"></div>`;
    document.getElementById("dir-controls").style.display = "block";
    document.getElementById("upload-container").style.display = "block";
    loadUploadedFiles();
    loadFiles(currentPath);
    updateDirectoryControls();  // New call to update deletion button state.
  }

}

// -------------------------
// Markdown Page Functions
// -------------------------

function loadPage(path) {
  fetch(`/api/page?path=${encodeURIComponent(path)}`)
    .then(response => {
      if (!response.ok) { throw new Error("Page not found"); }
      return response.text();
    })
    .then(text => {
      const html = converter.makeHtml(text);
      // Always show both Edit and Delete buttons on a markdown page.
      let actionButtons = `<button onclick="editPage()">Edit Page</button>
                           <button onclick="deletePage()">Delete Page</button>`;
      document.getElementById("page-view").innerHTML = html + `<br>${actionButtons}`;
    })
    .catch(err => {
      document.getElementById("page-view").innerHTML = `<p>Error: ${err.message}</p>`;
    });
}

function editPage() {
  if (!currentPath.endsWith(".md")) return;
  isEditing = true;
  unsavedChanges = false;
  document.getElementById("page-view").style.display = "none";
  document.getElementById("editor-container").style.display = "block";
  fetchWithAuth(`/api/page?path=${encodeURIComponent(currentPath)}`, { method: "GET" })
    .then(response => response.text())
    .then(text => {
      originalContent = text;
      if (!editor) {
        editor = CodeMirror.fromTextArea(document.getElementById("editor"), {
          mode: "markdown",
          lineNumbers: true,
          theme: "default"
        });
        editor.on("change", function () {
          unsavedChanges = (editor.getValue() !== originalContent);
        });
      }
      editor.setValue(text);
    })
    .catch(err => console.error("Error loading page for edit:", err));
}

function savePage() {
  const updatedContent = editor.getValue();
  fetchWithAuth(`/api/page?path=${encodeURIComponent(currentPath)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: updatedContent
  })
    .then(response => {
      if (response.ok) {
        cancelEdit();
        loadPage(currentPath);
      } else {
        alert("Failed to save page.");
      }
    })
    .catch(err => console.error("Save error:", err));
}

function cancelEdit() {
  isEditing = false;
  unsavedChanges = false;
  document.getElementById("editor-container").style.display = "none";
  document.getElementById("page-view").style.display = "block";
}

function deletePage() {
  if (!confirm("Are you sure you want to delete this page?")) return;
  fetchWithAuth(`/api/page?path=${encodeURIComponent(currentPath)}`, {
    method: "DELETE"
  })
    .then(response => {
      if (response.ok) {
        // After deletion, navigate to the parent directory.
        const parent = currentPath.split('/').slice(0, -1).join('/');
        navigateTo(parent);
      } else {
        alert("Failed to delete page.");
      }
    })
    .catch(err => console.error("Delete page error:", err));
}

// -------------------------
// Directory Operations (New Page & New Directory)
// -------------------------

function createNewPage() {
  const newName = prompt("Enter new Markdown filename (must end with .md):");
  if (newName && newName.endsWith(".md")) {
    const newPath = currentPath ? currentPath + "/" + newName : newName;
    fetchWithAuth(`/api/page?path=${encodeURIComponent(newPath)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: ""
    })
      .then(response => {
        if (response.ok) {
          loadFullSidebar();
          navigateTo(newPath);
        } else {
          alert("Failed to create new page.");
        }
      })
      .catch(err => console.error("Create page error:", err));
  } else {
    alert("Filename must end with .md");
  }
}

function createNewDirectory() {
  const newDir = prompt("Enter new directory name:");
  if (newDir && newDir.trim() !== "") {
    fetchWithAuth(`/api/dir?path=${encodeURIComponent(currentPath)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newDir.trim() })
    })
    .then(response => {
      if (response.ok) {
        loadFullSidebar();
        refreshCurrentView();
      } else {
        alert("Failed to create new directory.");
      }
    })
    .catch(err => console.error("Create directory error:", err));
  }
}


function deleteDirectory() {
  if (currentPath === "") {
    alert("Cannot delete the root directory.");
    return;
  }
  if (!confirm("Are you sure you want to delete this directory? It must be empty.")) return;
  fetchWithAuth(`/api/dir?path=${encodeURIComponent(currentPath)}`, {
    method: "DELETE"
  })
    .then(response => {
      if (response.ok) {
        const parent = currentPath.split('/').slice(0, -1).join('/');
        navigateTo(parent);
      } else {
        alert("Failed to delete directory (it may not be empty).");
      }
    })
    .catch(err => console.error("Delete directory error:", err));
}

// -------------------------
// File Manager for Non‑Markdown Files
// -------------------------
/*
function loadFiles(dir) {
  fetch(`/api/dir?path=${encodeURIComponent(dir)}`)
    .then(response => response.json())
    .then(items => {
      // List only non‑Markdown files (and non-directories).
      const fileItems = (items || []).filter(item => {
        return item.type !== "dir" && !item.name.endsWith(".md");
      });
      let html = "<h3>Files</h3>";
      if (fileItems.length === 0) {
        html += "<p>No files found.</p>";
        if ((items || []).length === 0 && dir !== "") {
          html += `<button onclick="deleteDirectory()">Delete Directory</button>`;
        }
      } else {
        html += "<ul>";
        fileItems.forEach(file => {
          let filePath = dir ? dir + "/" + file.name : file.name;
          html += `<li>${file.name} 
                   <button onclick="deleteFile('${filePath}')">Delete</button>
                   </li>`;
        });
        html += "</ul>";
      }
      // Upload control.
      html += `<h4>Upload New File</h4>
               <input type="file" id="fileUpload" onchange="uploadFile('${dir}', this)" />`;
      let fm = document.getElementById("upload-container");
      fm.innerHTML = html;
      fm.style.display = "block";
    })
    .catch(err => console.error("Error loading files:", err));
}

function uploadFile(dir, input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  fetchWithAuth(`/api/upload?path=${encodeURIComponent(dir)}`, {
    method: "POST",
    body: formData
  })
    .then(response => {
      if (response.ok) {
        loadFiles(dir);
      } else {
        alert("Failed to upload file.");
      }
    })
    .catch(err => console.error("Upload error:", err));
}

function deleteFile(filePath) {
  if (!confirm("Are you sure you want to delete this file?")) return;
  // filePath is just the filename from current directory.
  const filename = filePath.split('/').pop();
  fetchWithAuth(`/api/upload?path=${encodeURIComponent(currentPath)}&file=${encodeURIComponent(filename)}`, {
    method: "DELETE"
  })
    .then(response => {
      if (response.ok) {
        loadFiles(currentPath);
      } else {
        alert("Failed to delete file.");
      }
    })
    .catch(err => console.error("Delete file error:", err));
}
*/

// -------------------------
// Fetch Wrapper (with Bearer token if available)
// -------------------------

function fetchWithAuth(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  const token = localStorage.getItem(authTokenKey);
  if (token) {
    options.headers["Authorization"] = "Bearer " + token;
  }
  return fetch(url, options);
}


// -------------------------
// Search Functionality
// -------------------------

function doSearch() {
  const query = document.getElementById("search-box").value;
  if (!query) return;
  fetch(`/api/search?q=${encodeURIComponent(query)}`)
    .then(response => response.json())
    .then(results => {
      let html = "<ul>";
      results.forEach(result => {
        html += `<li><a href="#" onclick="navigateSafely('${result.path}')">${result.name}</a></li>`;
      });
      html += "</ul>";
      document.getElementById("page-view").innerHTML = html;
      // When search results are shown, hide directory controls and file manager.
      document.getElementById("dir-controls").style.display = "none";
      document.getElementById("upload-container").style.display = "none";
    })
    .catch(err => console.error("Search error:", err));
}

// Load the uploaded (non-md) files from the current directory and display them.
function loadUploadedFiles() {
  fetch(`/api/dir?path=${encodeURIComponent(currentPath)}`)
    .then(response => response.json())
    .then(items => {
      const files = (items || []).filter(item => item.type !== "dir" && !item.name.endsWith(".md"));
      let html = "<ul>";
      files.forEach(file => {
        // Build a public URL (adjust the URL as needed for your setup)
        let fileUrl = `${window.location.origin}/content/${currentPath ? encodeURIComponent(currentPath) + "/" : ""}${encodeURIComponent(file.name)}`;
        html += `<li>${file.name}
                   <a target="_blank" class="upload-btn" href="${fileUrl}">View</a>
                   <button class="upload-btn" onclick="copyFileURL('${fileUrl}')">Copy URL</button>
                   <button class="upload-btn" onclick="deleteUploadedFile('${file.name}')">Delete</button>
                 </li>`;
      });
      html += "</ul>";
      document.getElementById("uploaded-files").innerHTML = html;
    })
    .catch(err => console.error("Error loading uploaded files:", err));
}

function copyFileURL(url) {
  navigator.clipboard.writeText(url) // no .then()
    .catch(err =>
    {
      alert('Failed to copy File URL to clipboard!');
      console.error("Error copying URL:", err);
    });
}

function deleteUploadedFile(filename) {
  if (!confirm("Are you sure you want to delete this file?")) return;
  fetchWithAuth(`/api/upload?path=${encodeURIComponent(currentPath)}&file=${encodeURIComponent(filename)}`, {
    method: "DELETE"
  })
  .then(response => {
    if (response.ok) {
      loadUploadedFiles();
    } else {
      alert("Failed to delete file.");
    }
  })
  .catch(err => console.error("Error deleting file:", err));
}

// Set up the drag and drop behavior on the drop area.
const dropArea = document.getElementById("upload-drop-area");
dropArea.addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
});
dropArea.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
});
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  let files = e.dataTransfer.files;
  handleFilesUpload(files);
});

function handleFileSelect(event) {
  let files = event.target.files;
  handleFilesUpload(files);
}

function handleFilesUpload(files) {
  if (!files.length) return;
  let formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append("file", files[i]);
  }
  fetchWithAuth(`/api/upload?path=${encodeURIComponent(currentPath)}`, {
    method: "POST",
    body: formData
  })
  .then(response => {
    if (response.ok) {
      loadUploadedFiles();
    } else {
      alert("Failed to upload file.");
    }
  })
  .catch(err => console.error("Upload error:", err));
}

