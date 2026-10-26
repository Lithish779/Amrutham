process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://amrutam:amrutam@localhost:5432/amrutam_test';
process.env.BCRYPT_ROUNDS = '4';
process.env.RATE_LIMIT_AUTH_PER_MIN = '1000';
process.env.RATE_LIMIT_GLOBAL_PER_MIN = '100000';
process.env.RATE_LIMIT_WRITE_PER_MIN = '100000';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || '';
delete process.env.DATABASE_READ_URL;
require('events').EventEmitter.defaultMaxListeners = 100;
