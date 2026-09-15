// ============================================================================
// MockPortalAdapter — a fully-working, clearly-labelled MOCK portal (§22).
// It exercises the ENTIRE journey end-to-end (registration, OTP, auto-fill,
// missing-info prompts, document selection, review, submission, status
// tracking) so the product flow is demonstrable WITHOUT pretending any real
// government portal has been automated.
//
// Nothing here contacts a real portal. Submission produces a clearly synthetic
// reference number prefixed "DEMO-". Status transitions are simulated on a
// timeline. The UI must show this as a demo integration.
// ============================================================================
import { PortalAdapter } from './PortalAdapter.js';

// Simulated status timeline (§6). Each step advances after ~1 status check.
const STATUS_FLOW = ['SUBMITTED', 'UNDER_REVIEW', 'DOCUMENT_VERIFICATION', 'APPROVED'];

export class MockPortalAdapter extends PortalAdapter {
  constructor() {
    super({
      id: 'mock_scholarship',
      name: 'SchemeSetu Demo Scholarship Portal',
      authType: 'REGISTRATION_REQUIRED',
      integrationMode: 'MOCK',
      statusLookup: 'REFERENCE_LOOKUP',
    });
  }

  buildPlan({ scheme }) {
    const schemeName = scheme?.name || 'this scheme';
    return [
      { type: 'AUTO', state: 'ELIGIBLE', event: 'ELIGIBILITY_CONFIRMED',
        detail: 'Eligibility confirmed for ' + schemeName },

      { type: 'AUTO', state: 'REGISTRATION_REQUIRED', event: 'ACCOUNT_STATE_DETECTED',
        detail: 'No existing portal account found — registration required' },

      // Registration form auto-filled from the SchemeSetu profile.
      { type: 'AUTOFILL', state: 'REGISTERING', fields: ['full_name', 'email', 'phone'],
        event: 'REGISTRATION_FIELDS_POPULATED', detail: 'Registration form auto-filled from profile' },

      // Portal sends an OTP; automation pauses for the human (§2, §11). The OTP
      // value is used only to advance and is NEVER persisted (engine enforces).
      { type: 'HUMAN_INPUT', state: 'OTP_REQUIRED', secret: true,
        input: {
          type: 'OTP',
          title: 'OTP required', title_hi: 'ओटीपी आवश्यक',
          message: 'Enter the OTP sent to your registered mobile number.',
          message_hi: 'अपने पंजीकृत मोबाइल नंबर पर भेजा गया ओटीपी दर्ज करें।',
        },
        event: 'OTP_REQUESTED',
        onComplete: { event: 'OTP_COMPLETED', detail: 'User completed OTP verification' } },

      { type: 'AUTO', state: 'ACCOUNT_CREATED', event: 'ACCOUNT_CREATED', detail: 'Portal account created' },
      { type: 'AUTO', state: 'AUTHENTICATED', event: 'AUTHENTICATED', detail: 'Authenticated on portal' },

      // Application form auto-filled from profile.
      { type: 'AUTOFILL', state: 'FORM_FILLING',
        fields: ['full_name', 'date_of_birth', 'gender', 'social_category', 'state', 'district', 'annual_income', 'education_level'],
        event: 'FORM_STARTED', detail: 'Application form auto-filled from profile' },

      // Ask ONLY for what the profile can't supply (§10). Skipped automatically
      // if already collected.
      { type: 'HUMAN_INPUT', state: 'USER_INPUT_REQUIRED', field: 'father_name',
        input: {
          type: 'TEXT',
          title: 'Information required', title_hi: 'जानकारी आवश्यक',
          message: 'To continue your application, we need your father\'s full name.',
          message_hi: 'आपका आवेदन जारी रखने के लिए, हमें आपके पिता का पूरा नाम चाहिए।',
        },
        event: 'INFO_REQUESTED', onComplete: { event: 'INFO_PROVIDED', detail: 'Collected: father\'s full name' } },

      { type: 'HUMAN_INPUT', state: 'USER_INPUT_REQUIRED', field: 'bank_account',
        input: {
          type: 'TEXT',
          title: 'Information required', title_hi: 'जानकारी आवश्यक',
          message: 'Enter the bank account number where the benefit should be credited.',
          message_hi: 'वह बैंक खाता संख्या दर्ज करें जहाँ लाभ जमा किया जाना है।',
        },
        event: 'INFO_REQUESTED', onComplete: { event: 'INFO_PROVIDED', detail: 'Collected: bank account number' } },

      // Attach a required document from the vault, else pause and ask (§13).
      { type: 'DOCUMENT', state: 'DOCUMENT_REQUIRED', documentType: 'income_certificate',
        event: 'DOCUMENT_ATTACHED' },

      // Explicit review + consent before submit (§20, §21). The frontend renders
      // the full form summary from form_data alongside this consent.
      { type: 'HUMAN_INPUT', state: 'READY_FOR_REVIEW', review: true,
        input: {
          type: 'CONSENT',
          title: 'Review & confirm submission', title_hi: 'समीक्षा करें और पुष्टि करें',
          message: 'I have reviewed my application details and authorise SchemeSetu to submit this application.',
          message_hi: 'मैंने अपने आवेदन विवरण की समीक्षा कर ली है और SchemeSetu को यह आवेदन जमा करने के लिए अधिकृत करता/करती हूँ।',
        },
        event: 'APPLICATION_REVIEWED', onComplete: { event: 'CONSENT_GIVEN', detail: 'User approved submission' } },

      { type: 'SUBMIT', state: 'SUBMITTED', event: 'APPLICATION_SUBMITTED' },
    ];
  }

  // Synthetic reference number (clearly a demo).
  makeReference() {
    return 'DEMO-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 9000 + 1000);
  }

  // Simulated status progression driven by how many checks have occurred.
  async getApplicationStatus(app) {
    const current = app.current_status || 'SUBMITTED';
    const idx = STATUS_FLOW.indexOf(current);
    if (idx === -1 || idx >= STATUS_FLOW.length - 1) {
      return { status: current, changed: false };
    }
    const next = STATUS_FLOW[idx + 1];
    return {
      status: next,
      changed: true,
      detail: `Portal status advanced to ${next}`,
    };
  }
}
