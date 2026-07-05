/**
 * V2 对外接口 — 异常状态回写：V3 通知 V2 运单的异常工单状态
 */
import { NextRequest, NextResponse } from "next/server";

// 简单内存存储异常标记（生产环境应存数据库）
const exceptionStatusMap = new Map<string, { has_open_ticket: boolean; updated_at: string }>();

export async function POST(req: NextRequest) {
  try {
    // 鉴权
    const auth = req.headers.get("authorization");
    if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || "v3-internal-key"}`) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await req.json();
    const { external_code, has_open_ticket } = body;

    if (!external_code) {
      return NextResponse.json({ error: "缺少运单号" }, { status: 400 });
    }

    exceptionStatusMap.set(external_code, {
      has_open_ticket: !!has_open_ticket,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const externalCode = searchParams.get("external_code");

    if (!externalCode) {
      return NextResponse.json({ error: "缺少运单号" }, { status: 400 });
    }

    const status = exceptionStatusMap.get(externalCode);
    return NextResponse.json(status || { has_open_ticket: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
