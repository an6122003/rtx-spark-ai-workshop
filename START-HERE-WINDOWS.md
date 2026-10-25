# BẮT ĐẦU TỪ ĐÂY · START HERE — WINDOWS

**Workshop AI trên NVIDIA RTX Spark (Windows) — cài đặt và trình diễn**
**AI Workshop on the NVIDIA RTX Spark (Windows) — setup and presenting**

> Bạn **không cần biết lập trình**. Chỉ cần dán đúng một lệnh.
> You do **not** need to know how to program. You paste one command.
>
> Nếu có gì sai, gửi tệp `setup-log.txt` (trong thư mục `ai-workshop`) cho người phụ trách.
> If anything goes wrong, send the file `setup-log.txt` (in the `ai-workshop` folder) to the organiser.
>
> Máy DGX Spark (Linux) dùng hướng dẫn khác: [START-HERE.md](START-HERE.md).
> The DGX Spark (Linux) has its own guide: [START-HERE.md](START-HERE.md).

---

## Đây là gì? · What is this?

Bản Windows của workshop, cho các máy **NVIDIA RTX Spark** (Windows 11 trên chip Arm).
Mọi thứ chạy **ngay trên máy**, không gửi dữ liệu lên internet:
The Windows edition of the workshop, for **NVIDIA RTX Spark** PCs (Windows 11 on Arm).
Everything runs **on the PC itself**; nothing is sent to the internet:

| | Bài · Lab | Khán giả sẽ thấy · The audience sees |
|---|---|---|
| **1** | Tinh chỉnh mô hình · Fine-tuning | Một mô hình nhỏ được "dạy lại" trên GPU, rồi so sánh trước/sau · A small model retrained on the GPU, compared before/after |
| **2** | RAG trên máy · RAG on the PC | Hỏi 28 tài liệu kỹ thuật, câu trả lời kèm nguồn · Ask 28 manuals; every answer shows its source |
| **3** | Agent phân tích dữ liệu · Agentic workflow | Hỏi bằng tiếng Việt, AI tự đọc Excel, phân tích, vẽ biểu đồ, xuất báo cáo · Ask in Vietnamese; the AI reads Excel, analyses, charts, exports a report |
| **04** | Doanh nghiệp · Enterprise | Hàng nghìn tin nhắn, hóa đơn và cuộc gọi được xử lý theo lô · Thousands of messages, invoices and calls processed in batches |

**Khác với bản DGX Spark · Different from the DGX Spark edition:**
không có sandbox NemoClaw (Bài 2–3 chạy trực tiếp trên máy) và không có tab thử thách
OpenClaw; tab Doanh nghiệp dùng llama.cpp thay cho vLLM.
there is no NemoClaw sandbox (Labs 2–3 run directly on the PC) and no OpenClaw
challenge tab; the Enterprise tab uses llama.cpp instead of vLLM.

---

## Cần chuẩn bị · What you need

| | |
|---|---|
| ✅ | Máy **RTX Spark** với Windows 11, có **internet** (chỉ cần khi cài đặt) · The **RTX Spark** with Windows 11, with **internet** (for setup only) |
| ✅ | Khoảng **70 GB** trống; tải khoảng **58 GB**: **40 phút** với mạng nhanh, tới **2 giờ** với mạng chậm · About **70 GB** free; about **58 GB** is downloaded: **40 minutes** on a fast connection, up to **2 hours** on a slow one |
| ✅ | **Cắm sạc** và **để mở nắp** máy trong lúc cài · **Plug in the charger** and **keep the lid open** while it installs |
| ✅ | **Không cần** mật khẩu quản trị hay Developer Mode · **No** administrator password or Developer Mode needed |

---

## Bước 1 · Mở PowerShell · Step 1 · Open PowerShell

Nhấn phím **Windows**, gõ **PowerShell**, rồi mở **Windows PowerShell** (hoặc **Terminal**).
Press the **Windows** key, type **PowerShell**, and open **Windows PowerShell** (or **Terminal**).

---

## Bước 2 · Dán MỘT lệnh duy nhất · Step 2 · Paste ONE command

Dán lệnh này (chuột phải để dán) rồi nhấn **Enter**:
Paste this command (right-click pastes) and press **Enter**:

```powershell
irm https://raw.githubusercontent.com/an6122003/rtx-spark-ai-workshop/main/install.ps1 | iex
```

Lệnh này tải workshop về thư mục `ai-workshop` trong thư mục người dùng, cài mọi thứ,
huấn luyện thử mô hình mẫu, kiểm tra từng bài, rồi mở workshop trên trình duyệt.
It downloads the workshop into the `ai-workshop` folder of your user profile, installs
everything, trains the example model once, checks every lab, and opens the workshop
in the browser.

1. Một thông báo liệt kê phần mềm sẽ được cài. Nhấn **Enter** để đồng ý.
   A notice lists the software it installs. Press **Enter** to agree.
2. Để máy tự chạy. **Đừng đóng cửa sổ.** Phần lâu nhất là tải mô hình AI (khoảng 58 GB).
   Máy sẽ không tự ngủ trong lúc cài.
   Let it run. **Do not close the window.** The longest part is downloading the AI models (about 58 GB).
   The PC will not go to sleep while it installs.
3. Cuối cùng là bảng tổng kết: mỗi phần **✔ sẵn sàng** hoặc **✘ cần hỗ trợ**.
   At the end, a summary: each part **✔ ready** or **✘ needs help**.

---

## Lần sau · Next time

Bấm đúp biểu tượng **RTX Spark Workshop** trên màn hình nền (hoặc trong menu Start).
Trình duyệt mở workshop tại **http://127.0.0.1:8090**.
Double-click **RTX Spark Workshop** on the desktop (or in the Start menu). The browser
opens the workshop at **http://127.0.0.1:8090**.

- **Đóng cửa sổ màu đen** sẽ dừng ứng dụng workshop. Ollama vẫn chạy nền để mô hình
  không phải nạp lại. **Closing the black window** stops the workshop app; Ollama keeps
  running in the background so the models stay loaded.
- Dừng hẳn mọi thứ · Stop everything: `powershell -ExecutionPolicy Bypass -File "$HOME\ai-workshop\windows\stop.ps1"`
- Cập nhật · Update: chạy lại đúng lệnh ở Bước 2 (mô hình đã tải được giữ nguyên) ·
  run the Step 2 command again (downloaded models are kept).
- Máy không cần internet sau khi cài · No internet needed after setup.

---

## Trình diễn · Presenting

Giống bản DGX Spark: xem phần trình diễn từng bài trong [START-HERE.md](START-HERE.md).
Tab Doanh nghiệp là **04** (không có tab OpenClaw), và nút chọn máy chủ ghi
**llama.cpp · theo lô** thay cho vLLM.
The same as on the DGX Spark: see each lab's walkthrough in [START-HERE.md](START-HERE.md).
The Enterprise tab is **04** (there is no OpenClaw tab), and the engine switch reads
**llama.cpp · in batches** instead of vLLM.

Workshop mở bằng trang studio: giao diện sáng, không gắn sự kiện, hình chip phía sau sáng lên
theo công việc thật của GPU. Phím **1–4** chuyển giữa các bài. Trang sự kiện cũ vẫn ở
**http://127.0.0.1:8090/classic**.
The workshop opens on the studio page: a light interface with no event branding, whose chip
in the background lights up with the GPU's real work. Keys **1–4** switch between the labs. The
previous event page stays at **http://127.0.0.1:8090/classic**.

Thời gian đo trên máy RTX Spark · Measured on an RTX Spark:

| | |
|---|---|
| Bài 1 · Lab 1 | Huấn luyện 55 bước ≈ **40 giây**, cả quy trình ≈ 1,5 phút · 55 training steps ≈ **40 s**, the whole run ≈ 1.5 min |
| Bài 2 · Lab 2 | Câu trả lời trong **1–3 giây** · Answers in **1–3 s** |
| Bài 3 · Lab 3 | Agent xong trong khoảng **10 giây** · The agent finishes in about **10 s** |
| 04 · Tin nhắn · Inbox | **300** tin ≈ 4 phút (khoảng 80 tin/phút) · **300** messages ≈ 4 min (about 80 a minute) |
| 04 · Hóa đơn · Invoices | **100** hóa đơn ≈ 10 phút: bấm chạy **trước** khi giới thiệu · **100** invoices ≈ 10 min: start it **before** you talk about it |
| 04 · Cuộc gọi · Calls | **30** cuộc gọi ≈ 4 phút · **30** calls ≈ 4 min |

Lần đầu bấm chạy, máy chủ theo lô cần khoảng 30 giây để khởi động.
The first batch of a session waits about 30 seconds for the engine to start.

---

## Khi có lỗi · When something fails

| Bạn thấy · You see | Làm gì · What to do |
|---|---|
| `running scripts is disabled` | Dùng đúng lệnh `irm … \| iex` ở Bước 2, hoặc biểu tượng trên màn hình nền · Use the exact `irm … \| iex` command, or the desktop icon |
| ✘ ở một bài · ✘ on a lab | Chạy lại lệnh cài đặt (an toàn); nếu vẫn lỗi, gửi `setup-log.txt` · Run the install command again (safe); if it still fails, send `setup-log.txt` |
| "Ollama found no usable GPU" | Cập nhật driver NVIDIA của máy, rồi chạy lại lệnh cài đặt · Update the PC's NVIDIA driver, then run the install command again |
| "Smart App Control is on" | Nhờ IT tắt Smart App Control (Windows Security › App & browser control), rồi chạy lại lệnh cài đặt · Ask IT to turn off Smart App Control (Windows Security › App & browser control), then run the install command again |
| Tab Doanh nghiệp không hiện · No Enterprise tab | Phần này chưa cài xong: chạy lại lệnh cài đặt · It did not finish installing: run the install command again |

> Đã kiểm tra trên máy RTX Spark thật (ASUS ProArt P16, NVIDIA RTX Spark N1X, 128 GB,
> Windows 11 build 28000): cài lần đầu mất 38 phút với mạng khoảng 350 Mbit/s, cả bốn phần ✔.
> Mỗi lần thay đổi còn được kiểm tra tự động trên máy Windows-on-Arm của GitHub (không có GPU).
> Tested on a real RTX Spark (ASUS ProArt P16, NVIDIA RTX Spark N1X, 128 GB, Windows 11
> build 28000): the first install took 38 minutes on about 350 Mbit/s, all four parts ✔.
> Every change is also tested automatically on GitHub's Windows-on-Arm machines (no GPU).
