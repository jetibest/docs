package main

import (
	//"encoding/base64"
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"errors"
	"io/fs"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Global configuration variables set from command-line flags.
var (
	storagePath string
	// authTokens is a map of valid tokens for quick lookup.
	authTokens = make(map[string]bool)
)

func main() {
	storageDir := flag.String("storage", "./public_html/content", "Path to storage directory (containing your markdown and media files)")
	// NOTE: storage directory must have a symlink at ./public_html/content pointing at it, if the directory is customized!
	authTokensFile := flag.String("authtokens", "./auth_tokens.txt", "File containing valid auth tokens, one per line")
	port := flag.String("port", "8080", "Port to run the server on")
	flag.Parse()

	if *storageDir == "" {
		fmt.Println("Usage: docs -storage=path/to/storage [-authtokens=path/to/tokens.txt] [-port=8080]")
		os.Exit(1)
	}

	var err error
	storagePath, err = filepath.Abs(*storageDir)
	if err != nil {
		fmt.Println("Error determining absolute path for storage:", err)
		os.Exit(1)
	}
	
	if err = os.Mkdir(storagePath, 0755); err != nil && !errors.Is(err, fs.ErrExist) {
		fmt.Println("Failed to create storage path (%s):", storagePath, err)
		os.Exit(1)
	}

	// Load auth tokens if provided.
	if *authTokensFile != "" {
		if err := loadAuthTokens(*authTokensFile); err != nil {
			fmt.Println("Error loading auth tokens:", err)
			os.Exit(1)
		}
	}
	
	
	/*
	// Parse command-line arguments.
	authCred := flag.String("auth", "", "Credentials in user:pass format for basic authentication")
	storageDir := flag.String("storage", "", "Path to storage directory (must contain your markdown files and media)")
	port := flag.String("port", "8080", "Port to run the server on")
	flag.Parse()

	if *authCred == "" || *storageDir == "" {
		fmt.Println("Usage: docs -auth=user:pass -storage=path/to/storage [-port=8080]")
		os.Exit(1)
	}

	// Split auth credentials.
	parts := strings.SplitN(*authCred, ":", 2)
	if len(parts) != 2 {
		fmt.Println("Auth credentials must be in user:pass format")
		os.Exit(1)
	}
	authUser, authPass = parts[0], parts[1]

	// Set storagePath (ensure it is an absolute path)
	var err error
	storagePath, err = filepath.Abs(*storageDir)
	if err != nil {
		fmt.Println("Error determining absolute path for storage:", err)
		os.Exit(1)
	}
	*/

	// Serve static assets from public_html.
	http.Handle("/", http.FileServer(http.Dir("public_html")))
	// API endpoints for CMS functionality.
	http.HandleFunc("/api/page", pageHandler)
	http.HandleFunc("/api/dir", dirHandler)
	http.HandleFunc("/api/upload", uploadHandler)
	http.HandleFunc("/api/search", searchHandler)

	fmt.Printf("Starting docs CMS server on port %s...\n", *port)
	fmt.Printf("Using storage directory: %s\n", storagePath)
	err = http.ListenAndServe(":" + *port, nil)
	if err != nil {
		fmt.Println("Server Error:", err)
	}
}


func loadAuthTokens(filepath string) error {
	file, err := os.Open(filepath)
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		token := strings.TrimSpace(scanner.Text())
		if token != "" {
			authTokens[token] = true
		}
	}
	return scanner.Err()
}

// bearerAuth checks the request for a valid Bearer token.
func bearerAuth(w http.ResponseWriter, r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		http.Error(w, "Authorization required", http.StatusUnauthorized)
		return false
	}
	token := strings.TrimSpace(authHeader[len("Bearer "):])
	if !authTokens[token] {
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return false
	}
	return true
}


// --- HANDLERS ---

// pageHandler handles GET (read), POST (edit/create), and DELETE operations on markdown pages.
// URL parameter: ?path=relative/path/to/file.md
func pageHandler(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		http.Error(w, "Missing path parameter", http.StatusBadRequest)
		return
	}
	absPath := filepath.Join(storagePath, relPath)

	// Ensure the file is under the storage directory
	if !strings.HasPrefix(absPath, storagePath) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		// For GET, return file content if exists.
		data, err := ioutil.ReadFile(absPath)
		if err != nil {
			http.Error(w, "Could not read file", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.Write(data)

	case "POST":
		// POST is used to create or update a markdown page.
		// Require authentication.
		if !bearerAuth(w, r) {
			return
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read body", http.StatusBadRequest)
			return
		}
		// Create any missing directories.
		dir := filepath.Dir(absPath)
		if err = os.MkdirAll(dir, 0755); err != nil {
			http.Error(w, "Failed to create directories", http.StatusInternalServerError)
			return
		}
		if err = ioutil.WriteFile(absPath, body, 0644); err != nil {
			http.Error(w, "Failed to write file", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "File %s saved", relPath)

	case "DELETE":
		// DELETE a page; require authentication.
		if !bearerAuth(w, r) {
			return
		}
		if err := os.Remove(absPath); err != nil {
			http.Error(w, "Could not delete file", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "File %s deleted", relPath)

	default:
		http.Error(w, "Unsupported method", http.StatusMethodNotAllowed)
	}
}

// dirHandler handles directory listing and creation/deletion of directories.
// GET: lists content of the directory (markdown files and uploaded files)
// POST: create a new directory (requires auth)
// DELETE: remove a directory (only if empty, requires auth)
// URL parameter: ?path=relative/path/to/dir
func dirHandler(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	absDir := filepath.Join(storagePath, relPath)

	// Ensure the directory is under the storage.
	if !strings.HasPrefix(absDir, storagePath) {
		http.Error(w, "Invalid directory path", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		entries, err := ioutil.ReadDir(absDir)
		if err != nil {
			http.Error(w, "Directory not found", http.StatusNotFound)
			return
		}
		items := []map[string]string{}
		for _, entry := range entries {
			item := map[string]string{
				"name": entry.Name(),
				"type": "file",
			}
			if entry.IsDir() {
				item["type"] = "dir"
			}
			items = append(items, item)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)

	case "POST":
		// Create a new directory.
		if !bearerAuth(w, r) {
			return
		}
		// Read JSON body with a field "name" for the new directory.
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			http.Error(w, "Invalid JSON or missing name", http.StatusBadRequest)
			return
		}
		newDir := filepath.Join(absDir, req.Name)
		if err := os.Mkdir(newDir, 0755); err != nil {
			http.Error(w, "Failed to create directory", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Directory %s created", req.Name)

	case "DELETE":
		// Remove the directory; only if empty.
		if !bearerAuth(w, r) {
			return
		}
		// Using os.Remove, which fails if directory not empty.
		if err := os.Remove(absDir); err != nil {
			http.Error(w, "Directory not empty or could not be removed", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Directory %s deleted", relPath)

	default:
		http.Error(w, "Unsupported method", http.StatusMethodNotAllowed)
	}
}

// uploadHandler handles file uploads and deletion for files in a given directory.
// For upload: POST the file data with multipart form.
func uploadHandler(w http.ResponseWriter, r *http.Request) {
	relPath := r.URL.Query().Get("path")
	absDir := filepath.Join(storagePath, relPath)
	// Ensure the directory is under the storage.
	if !strings.HasPrefix(absDir, storagePath) {
		http.Error(w, "Invalid directory path", http.StatusBadRequest)
		return
	}

	// Only allow authenticated users to upload or delete files.
	if !bearerAuth(w, r) {
		return
	}

	switch r.Method {
	case "POST":
		// Handle file upload (overwrites if exists).
		err := r.ParseMultipartForm(10 << 20) // limit upload size to 10 MB
		if err != nil {
			http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Failed to get file from form", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Save the file in the specified directory.
		targetPath := filepath.Join(absDir, header.Filename)
		out, err := os.Create(targetPath)
		if err != nil {
			http.Error(w, "Unable to create file", http.StatusInternalServerError)
			return
		}
		defer out.Close()
		if _, err = io.Copy(out, file); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "File %s uploaded", header.Filename)

	case "DELETE":
		// Delete a file; expect query parameter file=<filename>
		filename := r.URL.Query().Get("file")
		if filename == "" {
			http.Error(w, "Missing file parameter", http.StatusBadRequest)
			return
		}
		targetPath := filepath.Join(absDir, filename)
		if err := os.Remove(targetPath); err != nil {
			http.Error(w, "Failed to delete file", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "File %s deleted", filename)

	default:
		http.Error(w, "Unsupported method", http.StatusMethodNotAllowed)
	}
}

// searchHandler performs a simple search across markdown files and file names.
// URL parameter: ?q=keyword
func searchHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "Missing query", http.StatusBadRequest)
		return
	}
	results := []map[string]string{}

	// Walk the storagePath directory and look for matches.
	err := filepath.Walk(storagePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// skip problematic files
			return nil
		}
		// Only search markdown files or file names of any type.
		if !info.IsDir() && (filepath.Ext(info.Name()) == ".md" || strings.Contains(strings.ToLower(info.Name()), strings.ToLower(query))) {
			// if markdown, we can also search the content.
			match := false
			if filepath.Ext(info.Name()) == ".md" {
				data, err := ioutil.ReadFile(path)
				if err == nil && strings.Contains(strings.ToLower(string(data)), strings.ToLower(query)) {
					match = true
				}
			}
			if strings.Contains(strings.ToLower(info.Name()), strings.ToLower(query)) {
				match = true
			}
			if match {
				// Return the relative path.
				rel, err := filepath.Rel(storagePath, path)
				if err == nil {
					results = append(results, map[string]string{
						"path": rel,
						"name": info.Name(),
					})
				}
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, "Search error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// --- Utility functions ---

/*
// basicAuth is a simple middleware to check HTTP Basic Authentication credentials.
func basicAuth(w http.ResponseWriter, r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		w.Header().Set("WWW-Authenticate", `Basic realm="Restricted"`)
		http.Error(w, "Authorization required", http.StatusUnauthorized)
		return false
	}

	// Expected format "Basic <base64-encoded>"
	const prefix = "Basic "
	if !strings.HasPrefix(authHeader, prefix) {
		http.Error(w, "Invalid auth header", http.StatusUnauthorized)
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(authHeader[len(prefix):])
	if err != nil {
		http.Error(w, "Invalid base64 encoding", http.StatusUnauthorized)
		return false
	}
	creds := strings.SplitN(string(decoded), ":", 2)
	if len(creds) != 2 || creds[0] != authUser || creds[1] != authPass {
		w.Header().Set("WWW-Authenticate", `Basic realm="Restricted"`)
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return false
	}
	return true
}
*/
