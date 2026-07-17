variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "extra" {
  type    = map(string)
  default = {}
}

output "tags" {
  value = merge(
    {
      Project   = var.project
      Env       = var.env
      ManagedBy = "terraform"
    },
    var.extra
  )
}
