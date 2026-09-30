# AHAKUDOS — Tự chạy trên máy chủ AhaHandbook

Tài liệu dành cho đội dev AhaHandbook. Thư mục này (`VERCEL/`) chạy được **không cần Vercel**: `server.mjs` tái hiện đúng định tuyến, header và cache của `vercel.json`.

AHAKUDOS phục vụ tại **`https://handbook.ahamove.com/aha-kudos`**. Dữ liệu và email do **Google Apps Script + Google Sheet** xử lý; máy chủ này chỉ nhận yêu cầu từ trình duyệt, xác thực nhân viên, rồi chuyển tiếp (có ký HMAC) sang Apps Script.

```
Trình duyệt ── handbook.ahamove.com/aha-kudos/* ──▶ proxy AhaHandbook (đăng nhập Keycloak)
                                                     │  + token/identity của nhân viên
                                                     ▼
                                        node server.mjs  (thư mục này)
                                                     │  POST ký HMAC (GAS_BRIDGE_SECRET)
                                                     ▼
                                   Google Apps Script  →  Google Sheet (DATA, KUDOS…) + email
```

## 1. Yêu cầu
- **Node.js 22** (tối thiểu 20). Không có dependency nào — **không cần `npm install`**.
- HTTPS ở phía proxy AhaHandbook.
- Máy chủ gọi ra được `https://script.google.com` và `https://script.googleusercontent.com`.

## 2. Biến môi trường (production)

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `AHA_ENV` | `production` | |
| `APP_ORIGIN` | `https://handbook.ahamove.com` | Phải **giống hệt** `APP_ORIGIN` trong Script Properties của Apps Script. Dùng để chặn yêu cầu từ trang khác (CSRF) |
| `APP_BASE_PATH` | `/aha-kudos` | Đường dẫn AHAKUDOS trên Handbook |
| `HANDBOOK_ORIGIN` | `https://handbook.ahamove.com` | |
| `GAS_EXEC_URL` | `https://script.google.com/macros/s/…/exec` | Web app URL của Apps Script — **chủ sản phẩm cung cấp** |
| `GAS_BRIDGE_SECRET` | 64 ký tự hex | **Bí mật**, bằng `VERCEL_BRIDGE_SECRET` trong Apps Script — nhận qua kênh bảo mật, không gửi qua chat/email |
| `IDENTITY_MODE` | `oidc` (khuyến nghị) hoặc `trusted_header` | Xem mục 4 |
| `ENABLE_DEV_IDENTITY` | `false` | `server.mjs` **từ chối khởi động** nếu `true` ở production |
| `PORT` / `HOST` | ví dụ `3000` / `127.0.0.1` | Mặc định `3000` / `0.0.0.0` |

OIDC (mặc định đã đúng với Keycloak Ahamove, chỉ đổi khi khác): `OIDC_ISSUER` (`https://auth.ahamove.com/realms/hr`), `OIDC_AUDIENCE` (`handbook`), `OIDC_JWKS_URL`, `OIDC_TOKEN_HEADERS` (`x-forwarded-access-token,x-auth-request-access-token,authorization`), `OIDC_EMAIL_CLAIM` (`email`).

Trusted header (dự phòng): `TRUSTED_PROXY_SECRET` (64 hex, bí mật), `TRUSTED_EMAIL_HEADER` (`x-auth-request-email`), `TRUSTED_PROXY_SECRET_HEADER` (`x-ahakudos-proxy-secret`).

## 3. Chạy
```bash
cd aha-kudos
cp .env.example .env        # điền giá trị thật (mục 2); không commit/chia sẻ file này
node tools/check-build.mjs  # kiểm tra gói + ghi private/build-id.txt (mã phiên bản file tĩnh)
node --env-file=.env server.mjs
```
Hoặc đặt biến môi trường bằng systemd / pm2 / Docker rồi chạy `npm start` (= kiểm tra gói + `node server.mjs`).
Chạy bằng systemd / pm2 / Docker tuỳ hạ tầng. Ví dụ Docker:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
```

## 4. Proxy AhaHandbook → server.mjs
- Chuyển `https://handbook.ahamove.com/aha-kudos/*` tới `http://<máy chủ>:3000/aha-kudos/*` (**giữ nguyên đường dẫn**; bỏ tiền tố cũng chạy được).
- **Danh tính nhân viên:**
  - `IDENTITY_MODE=oidc`: chuyển access token Keycloak của phiên hiện tại qua header `X-Forwarded-Access-Token` (hoặc `X-Auth-Request-Access-Token` / `Authorization: Bearer`). AHAKUDOS tự kiểm tra chữ ký JWT bằng JWKS của Keycloak.
  - `IDENTITY_MODE=trusted_header`: gửi `X-Auth-Request-Email: <email>` **và** `X-AhaKudos-Proxy-Secret: <TRUSTED_PROXY_SECRET>`.
  - **Luôn xoá** các header danh tính do trình duyệt tự gửi trước khi proxy thêm vào.
- Giữ header `Origin` của trình duyệt (không ghi đè).
- Nếu nhúng bằng iframe thay vì proxy: `APP_ORIGIN` phải là origin thật của trang được nhúng.

## 5. Kiểm tra sau khi chạy
1. `https://handbook.ahamove.com/aha-kudos/api/health` → `{"ok":true,"env":"production","basePath":"/aha-kudos","devIdentity":false,"buildId":"…"}`.
2. Mở `https://handbook.ahamove.com/aha-kudos/` bằng tài khoản nhân viên → thấy trang chủ AHAKUDOS với đúng tên.
3. Gửi thử 1 KUDOS → Admin duyệt → người nhận có email; link trong email mở đúng `…/aha-kudos/#/k/…`.

Lỗi thường gặp:
| Hiện tượng | Nguyên nhân |
|---|---|
| `/api/health` trả `503 CONFIG` | Thiếu/sai biến môi trường — `problems` trong kết quả chỉ ra biến nào |
| "Nguồn yêu cầu không được phép" | `APP_ORIGIN` khác origin thật của trang, hoặc proxy ghi đè `Origin` |
| Trang báo cần đăng nhập | Proxy chưa chuyển token/identity (mục 4) |
| Lỗi kết nối Apps Script / `ORIGIN_MISMATCH` | `GAS_EXEC_URL`/`GAS_BRIDGE_SECRET` sai, hoặc `APP_ORIGIN` hai bên không khớp |

## 6. Cập nhật phiên bản mới
Mỗi bản mới được gửi dưới dạng gói zip.
1. Thay toàn bộ nội dung thư mục bằng bản mới (**giữ lại** file cấu hình/biến môi trường của bạn — gói không chứa bí mật).
2. `npm start` (hoặc khởi động lại service). Bước kiểm tra gói chạy tự động và tạo mã phiên bản mới cho file tĩnh, nên trình duyệt tải bản mới ngay.
3. Mở `/aha-kudos/api/health` → `buildId` phải đổi sang mã mới.
Nếu gói kèm `Code.gs` mới, chủ sản phẩm cập nhật Apps Script (Deploy → New version) — không liên quan tới máy chủ này.

## 7. Bảo mật
- `server.mjs` chỉ phục vụ file trong `public/`; mã nguồn, `private/` và `lib/` không truy cập được qua web.
- Không có đường tắt dev/test (`/__dev/*` không tồn tại); không bật `ENABLE_DEV_IDENTITY` ở production.
- Bí mật (`GAS_BRIDGE_SECRET`, `TRUSTED_PROXY_SECRET`) chỉ đặt trong biến môi trường của máy chủ.
