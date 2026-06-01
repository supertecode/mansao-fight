# ===========================================================================
#  Servidor local de desenvolvimento SEM CACHE.
#  Igual ao "python -m http.server", porém manda cabeçalhos dizendo ao
#  navegador para NUNCA usar a cópia em cache. Assim, toda vez que você
#  recarrega a página, o game.js (e o resto) vem sempre na versão mais nova.
# ===========================================================================
import http.server
import socketserver

PORT = 8000


class HandlerSemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Desativa o cache para qualquer arquivo servido.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), HandlerSemCache) as httpd:
        print(f"Servidor (SEM cache) em http://localhost:{PORT}/index.html")
        print("Deixe esta janela ABERTA enquanto joga. Para parar, FECHE-A.")
        httpd.serve_forever()
