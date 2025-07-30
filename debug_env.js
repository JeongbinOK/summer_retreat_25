// Environment variable debugging script
console.log('🔍 ENVIRONMENT DEBUGGING:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0);
console.log('DATABASE_URL starts with postgresql:', process.env.DATABASE_URL ? process.env.DATABASE_URL.startsWith('postgresql://') : false);
console.log('PORT:', process.env.PORT);
console.log('All environment variables:');

// Only show non-sensitive env vars
const safeEnvVars = {};
Object.keys(process.env).forEach(key => {
    if (!key.toLowerCase().includes('password') && 
        !key.toLowerCase().includes('secret') && 
        !key.toLowerCase().includes('key') &&
        !key.toLowerCase().includes('token')) {
        safeEnvVars[key] = process.env[key];
    } else {
        safeEnvVars[key] = '[HIDDEN]';
    }
});

console.log(JSON.stringify(safeEnvVars, null, 2));