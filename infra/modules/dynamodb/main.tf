variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "enable_deletion_protection" {
  type    = bool
  default = false
}

locals {
  tables = {
    runs = {
      hash_key  = "pk"
      range_key = "sk"
      attributes = [
        { name = "pk", type = "S" },
        { name = "sk", type = "S" },
      ]
      ttl_attribute = null
    }
    checkpoints = {
      hash_key  = "pk"
      range_key = "sk"
      attributes = [
        { name = "pk", type = "S" },
        { name = "sk", type = "S" },
      ]
      ttl_attribute = null
    }
    ws-connections = {
      hash_key  = "connectionId"
      range_key = null
      attributes = [
        { name = "connectionId", type = "S" },
      ]
      ttl_attribute = "ttl"
    }
    users = {
      hash_key  = "userId"
      range_key = null
      attributes = [
        { name = "userId", type = "S" },
      ]
      ttl_attribute = null
    }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.tables

  name                        = "${var.name_prefix}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = each.value.hash_key
  range_key                   = each.value.range_key
  deletion_protection_enabled = var.enable_deletion_protection

  dynamic "attribute" {
    for_each = each.value.attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  dynamic "ttl" {
    for_each = each.value.ttl_attribute != null ? [each.value.ttl_attribute] : []
    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, { Table = each.key })
}

output "table_names" {
  value = { for k, t in aws_dynamodb_table.this : k => t.name }
}

output "table_arns" {
  value = { for k, t in aws_dynamodb_table.this : k => t.arn }
}

output "table_name_list" {
  value = [for t in aws_dynamodb_table.this : t.name]
}

output "table_arn_list" {
  value = [for t in aws_dynamodb_table.this : t.arn]
}
