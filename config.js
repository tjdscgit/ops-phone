// Configuration for the Roseberry Ops phone app.
//
// Everything here is safe to publish. The publishable key is designed to be
// embedded in client-side code — it grants nothing on its own, because every
// table has RLS requiring a signed-in user, and public signups are disabled.
// The VAPID public key is likewise public by definition; its matching private
// key lives only in GitHub Actions secrets and never reaches the browser.

window.OPS_CONFIG = {
  supabaseUrl: 'https://dcauvbdjizhyrdpiaeus.supabase.co',
  supabaseKey: 'sb_publishable_vvaQjqIORIdIWKAwQKzNjA_Ip-AJ10v',

  // Paste the PUBLIC half of your VAPID key pair here (see README in this
  // folder for how to generate it). Until it is set, the app still works for
  // quick-add — only the "Enable notifications" button is disabled.
  vapidPublicKey: 'BA_SE5GzV6auOl_ZmqvhLWIwVjnE975OODb5w7XmMDY344l6RMynRx18VLGpfvRui6HR0_r7z16GRpSh14-jhfY',
};
