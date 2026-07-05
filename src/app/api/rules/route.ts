/**
 * 解析规则 CRUD API
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { uid } from "@/lib/utils";

// GET /api/rules — 获取所有规则
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const rows = await query<any[]>("SELECT * FROM import_rules WHERE id = $1", [id]);
      if (rows.length === 0) {
        return NextResponse.json({ error: "规则不存在" }, { status: 404 });
      }
      const r = rows[0];
      return NextResponse.json({
        id: r.id,
        name: r.name,
        fileType: r.file_type,
        config: r.config,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }

    const rows = await query<any[]>("SELECT * FROM import_rules ORDER BY updated_at DESC");
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        fileType: r.file_type,
        config: r.config,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    );
  } catch (err: any) {
    console.error("GET /api/rules error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/rules — 创建规则
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, fileType, config } = body;

    if (!name || !fileType || !config) {
      return NextResponse.json({ error: "缺少必要字段" }, { status: 400 });
    }

    const id = uid("rule");
    await query(
      `INSERT INTO import_rules (id, name, file_type, config) VALUES ($1, $2, $3, $4)`,
      [id, name, fileType, JSON.stringify(config)]
    );

    return NextResponse.json({ id, name, fileType, config });
  } catch (err: any) {
    console.error("POST /api/rules error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/rules — 更新规则
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, fileType, config } = body;

    if (!id) {
      return NextResponse.json({ error: "缺少规则 ID" }, { status: 400 });
    }

    await query(
      `UPDATE import_rules SET name = COALESCE($2, name), file_type = COALESCE($3, file_type), config = COALESCE($4, config), updated_at = NOW() WHERE id = $1`,
      [id, name, fileType, config ? JSON.stringify(config) : null]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("PUT /api/rules error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/rules — 删除规则
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少规则 ID" }, { status: 400 });
    }

    await query("DELETE FROM import_rules WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/rules error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
