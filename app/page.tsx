'use client';

import { useState } from 'react';
import { Download, Loader2, FileDown } from 'lucide-react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setDownloadSuccess(false);

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const outputName = 'studocu-document.pdf';

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', outputName);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setDownloadSuccess(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50 text-gray-900">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8 border border-gray-100">
        <div className="flex items-center justify-center mb-6">
          <div className="bg-blue-100 p-3 rounded-full">
            <FileDown className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Studocu Downloader</h1>
        <p className="text-gray-500 text-center mb-8">
          Enter a Studocu document URL to download it as PDF.
        </p>

        <form onSubmit={handleDownload} className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
              Document URL
            </label>
            <input
              id="url"
              type="url"
              placeholder="https://www.studocu.com/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-gray-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-11"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download PDF
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-100 text-red-700 rounded-lg text-sm">
            ❌ {error}
          </div>
        )}

        {downloadSuccess && (
          <div className="mt-6 p-4 bg-green-50 border border-green-100 text-green-700 rounded-lg text-sm flex items-center gap-2">
            ✅ Download started successfully!
          </div>
        )}

        <div className="mt-8 text-xs text-center text-gray-400">
          This tool is for educational purposes only. <br />
          Respect copyright and terms of service.
        </div>
      </div>
    </main>
  );
}
