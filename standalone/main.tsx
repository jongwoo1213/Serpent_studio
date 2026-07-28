/**
 * 단일 HTML 배포용 진입점.
 *
 * app/page.tsx 는 전부 클라이언트 코드라 Next.js 없이 그대로 렌더링할 수 있다.
 * 여기서는 next/font 대신 시스템 폰트를 쓰므로 외부 네트워크 요청이 하나도 없다.
 */
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root 를 찾을 수 없습니다.");

createRoot(container).render(<Home />);
