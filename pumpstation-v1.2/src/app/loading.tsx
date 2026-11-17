export default function Loading() {
  return (
    <main dir="rtl" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#0e7490" }}>
      <div style={{ textAlign: "center" }}>
        <div className="dot live" style={{ width: 12, height: 12, borderRadius: 999, background: "#0e7490", margin: "0 auto 12px" }} />
        <p>در حال بارگذاری سامانه…</p>
      </div>
    </main>
  );
}
