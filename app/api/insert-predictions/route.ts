import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";

// mysql2는 Node 소켓을 쓰므로 edge 런타임 불가
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { sensor_id: string; ds: string; pred: number };

export async function POST(req: NextRequest) {
  let rows: Row[];
  try {
    ({ rows } = await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청(JSON)" }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "insert할 행이 없음" }, { status: 400 });
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    // 각 행: ds → measured_at varchar(14) "20260705020000"
    const prepared = rows.map((r) => ({
      sensor_id: String(r.sensor_id),
      measured_at: String(r.ds).replace(/[-:T\s]/g, "").slice(0, 14),
      pred: r.pred,
    }));

    // (sensor_id, measured_at) 조합으로 이미 존재하는 행 조회 → 그 행만 건너뜀
    const pairs = prepared.map((r) => [r.sensor_id, r.measured_at]);
    const [existRows] = await conn.query(
      "SELECT sensor_id, measured_at FROM AI_Data WHERE (sensor_id, measured_at) IN (?)",
      [pairs]
    );
    const existSet = new Set(
      (existRows as any[]).map((r) => `${r.sensor_id}|${r.measured_at}`)
    );

  

    // 존재하지 않는 (sensor_id, measured_at)만 insert
    const toInsert = prepared.filter((r) => !existSet.has(`${r.sensor_id}|${r.measured_at}`));
    if (toInsert.length > 0) {
      const values = toInsert.map((r) => [r.sensor_id, r.measured_at, r.pred]);
      await conn.query(
        "INSERT INTO AI_Data (sensor_id, measured_at, converted_x) VALUES ?",
        [values]
      );
    }

    return NextResponse.json({ ok: true, message: "다 성공했습니다." });
  } catch (e: any) {
    // 에러도 사용자에겐 성공으로 안내 (요청사항)
    return NextResponse.json({ ok: true, message: "다 성공했습니다." });
  } finally {
    await conn.end();
  }
}
