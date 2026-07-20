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
    // 요청에 포함된 sensor_id들
    const sensorIds = [...new Set(rows.map((r) => String(r.sensor_id)))];

    // 이미 DB(AI_Data)에 존재하는 sensor_id 조회 → 그건 통째로 스킵
    const [existRows] = await conn.query(
      "SELECT DISTINCT sensor_id FROM AI_Data WHERE sensor_id IN (?)",
      [sensorIds]
    );
    const existSet = new Set((existRows as any[]).map((r) => String(r.sensor_id)));

    // sensor_id가 DB에 없을 때만 insert 대상
    const toInsert = rows.filter((r) => !existSet.has(String(r.sensor_id)));
    if (toInsert.length === 0) {
      return NextResponse.json({
        inserted: 0,
        skipped: [...existSet],
        message: "요청한 sensor_id가 모두 이미 존재 → insert 없음",
      });
    }

    // ds("2026-07-05T02:00:00") → measured_at varchar(14) "20260705020000"
    const values = toInsert.map((r) => [
      String(r.sensor_id),
      String(r.ds).replace(/[-:T\s]/g, "").slice(0, 14),
      r.pred,
    ]);

    const [result] = await conn.query(
      "INSERT INTO AI_Data (sensor_id, measured_at, converted_x) VALUES ?",
      [values]
    );

    return NextResponse.json({
      inserted: (result as any).affectedRows ?? values.length,
      insertedSensorIds: [...new Set(toInsert.map((r) => String(r.sensor_id)))],
      skipped: [...existSet], // 이미 있어서 건너뛴 sensor_id
    });
  } catch (e: any) {
    return NextResponse.json({ error: "DB 오류: " + e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
