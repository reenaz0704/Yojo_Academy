#!/usr/bin/env python3
"""YOJO Shopping training site for Mission 9. Generates product JPEGs on startup; one holds the
per-session flag in its JPEG Comment (readable with `exiftool`). Serves the shop, images and /healthz.
No flag appears in HTML, filenames or page text; the designated image is chosen at random."""
import os, random, io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image, ImageDraw

FLAG = os.environ.get("LAB_CODE", "")
IMG_DIR = "/tmp/www/images"
PRODUCTS = [
    ("Aurora Wireless Headphones", "2,999", (34, 72, 140)),
    ("Terra Running Shoes", "3,499", (176, 92, 48)),
    ("Nimbus Backpack 25L", "1,799", (52, 120, 96)),
    ("Lumen Desk Lamp", "1,249", (190, 150, 40)),
    ("Pulse Smartwatch", "4,999", (120, 48, 140)),
    ("Breeze Cotton T-Shirt", "699", (60, 140, 180)),
    ("Grove Ceramic Mug", "449", (150, 80, 60)),
    ("Vega Bluetooth Speaker", "2,199", (40, 100, 110)),
    ("Clad Steel Water Bottle", "899", (90, 110, 130)),
    ("Fable Hardcover Notebook", "399", (130, 70, 100)),
]


def make_images():
    os.makedirs(IMG_DIR, exist_ok=True)
    flagged = random.randrange(len(PRODUCTS))  # which product hides the flag; never exposed
    for i, (name, price, color) in enumerate(PRODUCTS):
        im = Image.new("RGB", (480, 360), color)
        d = ImageDraw.Draw(im)
        d.rectangle([24, 24, 456, 336], outline=(255, 255, 255), width=5)
        d.ellipse([170, 110, 310, 250], fill=tuple(min(255, c + 45) for c in color))
        d.text((40, 300), name, fill=(255, 255, 255))
        kw = {"comment": FLAG.encode()} if i == flagged and FLAG else {}
        im.save(os.path.join(IMG_DIR, f"product-{i+1:02d}.jpg"), "JPEG", quality=85, **kw)


CSS = ("*{box-sizing:border-box}body{margin:0;font:16px/1.5 Arial,Helvetica,sans-serif;color:#1d2633;background:#f4f6f9}"
       "header{background:#13316b;color:#fff;padding:.9rem 1.25rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}"
       "header b{font-size:1.3rem;margin-right:auto}header a{color:#fff;text-decoration:none;font-size:.95rem}header .cart{font-size:1.2rem}"
       "nav{background:#1c43a0;color:#fff;padding:.5rem 1.25rem;display:flex;gap:1.2rem;flex-wrap:wrap}nav a{color:#dce6ff;text-decoration:none;font-size:.9rem}"
       ".search{margin-left:auto}.search input{padding:.35rem .6rem;border:0;border-radius:4px}"
       "main{max-width:72rem;margin:auto;padding:1.5rem 1.25rem}h1{color:#13316b;font-size:1.4rem}"
       ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1.2rem}"
       ".card{background:#fff;border:1px solid #e3e8f0;border-radius:10px;overflow:hidden}"
       ".card img{width:100%;height:auto;display:block}.card .b{padding:.7rem .9rem}.card h3{font-size:1rem;margin:.2rem 0}"
       ".price{color:#13316b;font-weight:700}.buy{display:block;margin:.5rem 0 0;background:#f6a609;color:#1d2633;border:0;border-radius:6px;padding:.45rem;width:100%;font-weight:700;cursor:pointer}"
       "footer{text-align:center;color:#78839a;padding:2rem;font-size:.9rem;border-top:1px solid #e3e8f0;margin-top:2rem}footer a{color:#78839a;margin:0 .5rem}")


def page():
    cards = "".join(
        f'<article class="card"><img src="/images/product-{i+1:02d}.jpg" alt="{n}" width="480" height="360">'
        f'<div class="b"><h3>{n}</h3><p class="price">&#8377;{p}</p><button class="buy">Add to cart</button></div></article>'
        for i, (n, p, _) in enumerate(PRODUCTS))
    return ("<!DOCTYPE html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>YOJO Shopping</title><style>{CSS}</style></head><body>"
            "<header><b>YOJO Shopping</b><a href='/'>Home</a><a href='/'>Deals</a><a href='/'>Orders</a><a href='/'>Help</a>"
            "<span class=cart>&#128722;</span></header>"
            "<nav><a href='/'>Electronics</a><a href='/'>Fashion</a><a href='/'>Home</a><a href='/'>Sports</a><a href='/'>Books</a>"
            "<span class=search><input placeholder='Search products'></span></nav>"
            "<main><h1>Featured products</h1><div class=grid>" + cards + "</div></main>"
            "<footer><a href='/'>About</a><a href='/'>Careers</a><a href='/'>Privacy</a><a href='/'>Terms</a><br>&copy; 2026 YOJO Shopping Pvt Ltd</footer></body></html>")


HTML = page().encode()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p == "/healthz":
            return self._send(200, b"ok", "text/plain")
        if p in ("/", "/index.html"):
            return self._send(200, HTML, "text/html; charset=utf-8")
        if p.startswith("/images/"):
            name = os.path.basename(p)
            if name.startswith("product-") and name.endswith(".jpg"):
                fp = os.path.join(IMG_DIR, name)
                if os.path.isfile(fp):
                    with open(fp, "rb") as f:
                        return self._send(200, f.read(), "image/jpeg")
        self._send(404, b"not found", "text/plain")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    make_images()
    ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
