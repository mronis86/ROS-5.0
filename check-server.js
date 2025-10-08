// Quick check to see what's wrong with server startup
console.log('Checking server.js configuration...\n');

// Check if database URL is set
if (!process.env.NEON_DATABASE_URL && !process.env.DATABASE_URL) {
    console.log('❌ ERROR: Database URL not set!');
    console.log('\nThe server needs NEON_DATABASE_URL environment variable.');
    console.log('\nTo fix this, run ONE of these commands first:\n');
    console.log('PowerShell:');
    console.log('  $env:NEON_DATABASE_URL="your-neon-url-here"');
    console.log('  node server.js\n');
    console.log('Command Prompt:');
    console.log('  set NEON_DATABASE_URL=your-neon-url-here');
    console.log('  node server.js\n');
    console.log('Your Neon database URL should look like:');
    console.log('  postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require');
    process.exit(1);
} else {
    console.log('✅ Database URL is set');
    const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
    const host = dbUrl.split('@')[1]?.split('/')[0];
    console.log(`   Host: ${host}`);
    console.log('\n✅ Server should start correctly!');
    console.log('\nRun: node server.js');
}

