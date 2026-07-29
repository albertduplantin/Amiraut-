import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1d4645",
          borderRadius: 96,
          color: "#fff",
          fontSize: 280,
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        H
      </div>
    ),
    size
  );
}
