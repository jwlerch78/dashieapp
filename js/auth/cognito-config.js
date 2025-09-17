// js/auth/cognito-config.js
// UPDATED: Cognito configuration replacing custom OAuth setup

// Environment detection
function getEnvironment() {
  const hostname = window.location.hostname;
  if (hostname === 'dashieapp.com') return 'production';
  if (hostname === 'dev.dashieapp.com') return 'development';
  return 'development'; // Default for localhost and other domains
}

const environment = getEnvironment();

// Cognito Configuration
export const COGNITO_CONFIG = {
  // AWS Cognito Settings
  region: 'us-east-2',
  userPoolId: 'us-east-2_nbo8y8lm',
  userPoolWebClientId: '6afq8v6qscc0cdnkbsg7m1i578',
  
  // Cognito Domain
  domain: 'us-east-2wnbo8y8lm.auth.us-east-2.amazoncognito.com',
  
  // OAuth Configuration
  oauth: {
    scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/photoslibrary.readonly'],
    redirectSignIn: environment === 'production' 
      ? 'https://dashieapp.com/auth/callback'
      : 'https://dev.dashieapp.com/auth/callback',
    redirectSignOut: environment === 'production'
      ? 'https://dashieapp.com/'
      : 'https://dev.dashieapp.com/',
    responseType: 'code' // Authorization Code Grant
  },
  
  // Storage Configuration
  storage: {
    userDataKey: 'dashie-cognito-user',
    sessionKey: 'dashie-cognito-session'
  }
};

// Amplify Configuration Object
export const AMPLIFY_CONFIG = {
  Auth: {
    region: COGNITO_CONFIG.region,
    userPoolId: COGNITO_CONFIG.userPoolId,
    userPoolWebClientId: COGNITO_CONFIG.userPoolWebClientId,
    oauth: {
      domain: COGNITO_CONFIG.domain,
      scope: COGNITO_CONFIG.oauth.scope,
      redirectSignIn: COGNITO_CONFIG.oauth.redirectSignIn,
      redirectSignOut: COGNITO_CONFIG.oauth.redirectSignOut,
      responseType: COGNITO_CONFIG.oauth.responseType
    }
  }
};

console.log('🔐 Cognito config loaded for environment:', environment);
console.log('🔐 Redirect URLs:', {
  signIn: COGNITO_CONFIG.oauth.redirectSignIn,
  signOut: COGNITO_CONFIG.oauth.redirectSignOut
});
