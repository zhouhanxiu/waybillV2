export type FileType = "excel" | "pdf";

export type FieldMapping = {
  target:
    | "external_code"
    | "store_name"
    | "receiver_name"
    | "receiver_phone"
    | "receiver_address"
    | "sku_code"
    | "sku_name"
    | "quantity"
    | "spec"
    | "remark";
  source: "column" | "row_label" | "static" | "regex" | "card_title" | "sheet_name";
  value: string | number;
  required?: boolean;
  transform?: "trim" | "number" | "phone" | "none";
};

export type StructureConfig = {
  headerRows?: number;
  titleRow?: number;
  dataStartRow?: number;
  dataEndMarker?: string;
  cardStartMarker?: string;
  trailingInfoStart?: number;
  trailingInfoEnd?: number;
  sheetMode?: "first" | "all" | "named";
  sheetNames?: string[];
};

export type ParseRule = {
  id: string;
  name: string;
  fileType: FileType;
  config: {
    structure: StructureConfig;
    fieldMappings: FieldMapping[];
    trailingInfo?: {
      enabled: boolean;
      mappings: FieldMapping[];
    };
    aggregation?: {
      enabled: boolean;
      keyField: "external_code";
    };
    matrixTranspose?: {
      enabled: boolean;
      skuNameColumn: string;
      specColumn?: string;
      storeRowFilters?: string[];
    };
    compositeSplit?: {
      enabled: boolean;
      pattern: string;
      separator: string;
    };
    staticDefaults?: Record<string, string | number>;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type ParsedRow = {
  external_code?: string;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  sku_code?: string;
  sku_name?: string;
  quantity?: number;
  spec?: string;
  remark?: string;
  [key: string]: any;
};

export type ValidationError = {
  rowIndex: number;
  field: string;
  message: string;
};

export type ImportBatch = {
  id: string;
  fileName: string;
  ruleId: string;
  status: "pending" | "done";
  createdAt: string;
};

export type Waybill = {
  id: string;
  external_code?: string;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  remark?: string;
  batch_id: string;
  createdAt: string;
  items: OrderItem[];
};

export type OrderItem = {
  id: string;
  waybill_id: string;
  sku_code: string;
  sku_name: string;
  quantity: number;
  spec?: string;
};
