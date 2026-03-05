package models

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const hfBaseURL = "https://huggingface.co"

// Downloader fetches models from HuggingFace Hub.
type Downloader struct {
	modelDir string
	token    string
}

func NewDownloader(modelDir, hfToken string) *Downloader {
	return &Downloader{modelDir: modelDir, token: hfToken}
}

type ModelFile struct {
	RFilename string `json:"rfilename"`
	Size      int64  `json:"size"`
}

func (d *Downloader) ListRepoFiles(repo string) ([]ModelFile, error) {
	url := fmt.Sprintf("%s/api/models/%s", hfBaseURL, repo)
	req, _ := http.NewRequest("GET", url, nil)
	if d.token != "" {
		req.Header.Set("Authorization", "Bearer "+d.token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HuggingFace API error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HuggingFace returned %d for repo %q", resp.StatusCode, repo)
	}

	var result struct {
		Siblings []ModelFile `json:"siblings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.Siblings, nil
}

func (d *Downloader) DownloadFile(repo, filename string, progress func(downloaded, total int64)) (string, error) {
	url := fmt.Sprintf("%s/%s/resolve/main/%s", hfBaseURL, repo, filename)
	req, _ := http.NewRequest("GET", url, nil)
	if d.token != "" {
		req.Header.Set("Authorization", "Bearer "+d.token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	localName := strings.ReplaceAll(filename, "/", "_")
	destPath := filepath.Join(d.modelDir, localName)

	f, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			f.Write(buf[:n])
			downloaded += int64(n)
			if progress != nil {
				progress(downloaded, total)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read error: %w", err)
		}
	}

	return destPath, nil
}

func (d *Downloader) PullWhisperModel(repo string, progress func(downloaded, total int64)) (string, error) {
	files, err := d.ListRepoFiles(repo)
	if err != nil {
		return "", err
	}

	for _, f := range files {
		if strings.HasSuffix(f.RFilename, ".bin") || strings.HasSuffix(f.RFilename, ".gguf") {
			fmt.Printf("Downloading %s (%.1f MB)...\n", f.RFilename, float64(f.Size)/(1024*1024))
			return d.DownloadFile(repo, f.RFilename, progress)
		}
	}
	return "", fmt.Errorf("no .bin/.gguf file found in repo %q", repo)
}
