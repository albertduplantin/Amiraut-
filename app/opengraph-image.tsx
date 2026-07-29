import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#1d4645",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 32,
            background: "#ffffff22",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 90,
            fontWeight: 800,
            marginBottom: 32,
          }}
        >
          H
        </div>
        <div style={{ fontSize: 64, fontWeight: 800 }}>Les Semaines de l&apos;Hexagone</div>
        <div style={{ fontSize: 32, color: "#d98f3f", marginTop: 16 }}>
          Séjours de jeux de société
        </div>
      </div>
    ),
    size
  );
}
