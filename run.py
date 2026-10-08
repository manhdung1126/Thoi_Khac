"""Run the THỜI KHẮC interfaces and API with one command."""

import argparse
import os
import socket
from pathlib import Path

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Chạy THỜI KHẮC")
    parser.add_argument("--lan", action="store_true", help="Cho phép điện thoại cùng Wi-Fi truy cập")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="Tự nạp lại khi sửa Python")
    args = parser.parse_args()
    pin = os.environ.get("CLOUD_ADMIN_PIN", "")
    if args.lan and (not pin.strip() or pin.strip() == "2468"):
        parser.error("Chạy LAN cần CLOUD_ADMIN_PIN riêng, không trống và khác mã thử nghiệm 2468.")
    root = Path(__file__).resolve().parent
    print(f"\nTHỜI KHẮC · http://127.0.0.1:{args.port}/control/")
    print(f"Draw: http://127.0.0.1:{args.port}/draw/")
    print(f"Display: http://127.0.0.1:{args.port}/display/")
    if args.lan:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
                connection.connect(("192.0.2.1", 9))
                lan_ip = connection.getsockname()[0]
            print(f"Điện thoại cùng Wi-Fi: http://{lan_ip}:{args.port}/draw/")
        except OSError:
            print(f"Điện thoại: http://<IP-của-máy>:{args.port}/draw/")
    print("Dừng server bằng Ctrl+C.\n", flush=True)
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0" if args.lan else "127.0.0.1",
        port=args.port,
        reload=args.reload,
        reload_dirs=[str(root / "backend" / "app")] if args.reload else None,
    )


if __name__ == "__main__":
    main()
