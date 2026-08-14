module.exports = {
    darkMode: 'class',

    content: [
        './index.html',
        './admin.html',
        './recover.html',
        './app.js',
        './supabase-auth.js',
        './privacy-vault.js',
        './supabase-data.js',
        './activity.js',
        './admin.js',
        './recover.js'
    ],

    theme: {
        extend: {
            colors: {
                blueSystem: {
                    50: '#f0f4ff',
                    100: '#e1e9ff',
                    200: '#c3d4ff',
                    500: '#0056a3',
                    600: '#004485',
                    700: '#003366',
                    900: '#001a33'
                }
            }
        }
    },

    plugins: []
};
