# Reference IaC for the data tier on AWS (ap-south-1 primary, ap-south-2 DR). Review variables before `terraform apply`.
terraform {
  required_version = ">= 1.6"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "region"        { default = "ap-south-1" }
variable "dr_region"     { default = "ap-south-2" }
variable "vpc_id"        { type = string }
variable "db_subnet_ids" { type = list(string) }
variable "app_sg_id"     { type = string }

provider "aws" { region = var.region }
provider "aws" {
  alias  = "dr"
  region = var.dr_region
}

resource "aws_kms_key" "data" {
  description         = "amrutam data-at-rest key"
  enable_key_rotation = true # automatic annual rotation of the KMS CMK
}

resource "aws_db_subnet_group" "pg" {
  name       = "amrutam-pg"
  subnet_ids = var.db_subnet_ids
}

resource "aws_security_group" "db" {
  name   = "amrutam-db"
  vpc_id = var.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_sg_id] # only the app tier can reach Postgres
  }
}

# Multi-AZ primary: synchronous standby in another AZ => automatic failover (~60-120s), RPO 0 within region
resource "aws_db_instance" "primary" {
  identifier                      = "amrutam-pg"
  engine                          = "postgres"
  engine_version                  = "16.4"
  instance_class                  = "db.r6g.2xlarge"
  allocated_storage               = 500
  max_allocated_storage           = 4000
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  multi_az                        = true
  db_subnet_group_name            = aws_db_subnet_group.pg.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  backup_retention_period         = 14 # PITR window (WAL archived continuously)
  deletion_protection             = true
  iam_database_authentication_enabled = true
  manage_master_user_password     = true # password lives in Secrets Manager, rotated automatically
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  skip_final_snapshot             = false
  final_snapshot_identifier       = "amrutam-pg-final"
}

# Read replica for search/analytics (DATABASE_READ_URL)
resource "aws_db_instance" "read_replica" {
  identifier             = "amrutam-pg-ro"
  replicate_source_db    = aws_db_instance.primary.identifier
  instance_class         = "db.r6g.xlarge"
  storage_encrypted      = true
  kms_key_id             = aws_kms_key.data.arn
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = true
}

# Cross-region DR: automated snapshot copy to the DR region (restore target for region loss; RPO <= 15 min with WAL replication, RTO <= 60 min)
resource "aws_db_instance_automated_backups_replication" "dr" {
  provider               = aws.dr
  source_db_instance_arn = aws_db_instance.primary.arn
  kms_key_id             = aws_kms_key.dr.arn
  retention_period       = 14
}
resource "aws_kms_key" "dr" {
  provider            = aws.dr
  description         = "amrutam DR backups"
  enable_key_rotation = true
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "amrutam-redis"
  description                = "cache, rate limits, BullMQ"
  engine                     = "redis"
  node_type                  = "cache.r6g.large"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  snapshot_retention_limit   = 7
}
