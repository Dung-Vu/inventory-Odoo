https://your-odoo-instance.odoo.com/jsonrpc

{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "service": "object",
    "method": "execute_kw",
    "args": [
      "your_database_name",
      0,
      "replace_with_your_odoo_api_key",
      "stock.move.line",
      "search_read",
      [[["picking_id.name", "=", "PICKING_CODE"]]],
      {
        "fields": [
          "product_id",
          "lot_id",
          "qty_done",
          "location_id",
          "location_dest_id"
        ]
      }
    ]
  },
  "id": 3
}
