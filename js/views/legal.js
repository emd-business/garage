// Privacy policy and terms of use: public pages, readable without signing in.
import { db } from '../api.js';
import { esc } from '../format.js';
import { isEn, langButton } from '../i18n.js';

const UPDATED = { ar: '١٠ نوفمبر ٢٠٢٦', en: '10 November 2026' };

const PRIVACY = {
  ar: ['سياسة الخصوصية', [
    ['من نحن', ['EMD Garage نظام سحابي لإدارة ورش وكراجات السيارات، تقدّمه EMD في سلطنة عُمان. توضّح هذه الصفحة ما نجمعه من بيانات ولماذا، وما حقوقك عليها.']],
    ['البيانات التي نجمعها', [
      'بيانات الحساب: الاسم والبريد الإلكتروني ورقم الهاتف وكلمة مرور مشفّرة.',
      'بيانات الكراج التي يدخلها صاحبه وموظفوه: العملاء وأرقام هواتفهم، السيارات ولوحاتها وأرقام الشاصي، أوامر العمل، الفواتير والمدفوعات، المخزون والموردون والمصروفات.',
      'الصور والملفات التي ترفعها: صور السيارات عند الاستلام، توقيع العميل، إيصالات المصروفات وفواتير الموردين، شعار الكراج وختمه.',
      'بيانات تقنية بسيطة لتشغيل الخدمة، مثل وقت الدخول.']],
    ['لمن تعود البيانات', ['بيانات كل كراج ملك لصاحبه. نحن نعالجها لتشغيل الخدمة له فقط، ولا نبيعها ولا نشاركها مع أي جهة لأغراض تسويقية. كل كراج معزول عن غيره، ولا يرى كراجٌ بيانات كراج آخر.']],
    ['كيف نستخدمها', [
      'تشغيل التطبيق وعرض بياناتك لك ولموظفيك حسب صلاحياتهم.',
      'إدارة الاشتراك والتواصل معك بشأن الخدمة.',
      'تحسين الخدمة ومعالجة الأعطال.',
      'لا نرسل رسائل إلى عملاء الكراج. رسائل واتساب يرسلها موظف الكراج بنفسه من هاتفه.']],
    ['أين تُحفظ', ['تُحفظ البيانات لدى مزوّد استضافة سحابي (Supabase) على خوادم مؤمّنة، وتُنقل عبر اتصال مشفّر. يحتفظ التطبيق بنسخة مؤقتة على جهازك لعرضها عند انقطاع الإنترنت، وتُمسح عند تسجيل الخروج.']],
    ['رابط متابعة العميل', ['يُنشئ الكراج لكل أمر عمل رابطاً خاصاً يرسله للعميل. من يملك الرابط يرى حالة السيارة وبنود العمل وأسعارها لذلك الأمر فقط، دون حاجة لحساب.']],
    ['مدة الاحتفاظ', ['نحتفظ ببيانات الكراج ما دام الاشتراك قائماً. بعد إنهاء الاشتراك وطلب الحذف نحذفها خلال ٣٠ يوماً، إلا ما يُلزم القانون بالاحتفاظ به من سجلات مالية وضريبية.']],
    ['حقوقك', [
      'الاطلاع على بياناتك وتصحيحها من داخل التطبيق في أي وقت.',
      'تصدير نسخة كاملة من بيانات كراجك من صفحة الإعدادات.',
      'طلب حذف حسابك وبيانات كراجك، كما في القسم التالي.']],
    ['حذف الحساب والبيانات', ['لطلب حذف حسابك أو بيانات كراجك راسلنا من البريد المسجّل في حسابك على وسيلة التواصل أدناه، واذكر اسم الكراج. نؤكد الطلب وننفّذه خلال ٣٠ يوماً. إن كنت موظفاً في كراج، فبيانات العمل تعود لصاحب الكراج، ونحذف حسابك الشخصي فقط.']],
    ['الأطفال', ['الخدمة موجّهة لأصحاب الأعمال وموظفيهم، وليست موجّهة لمن هم دون ١٨ عاماً.']],
    ['تعديل هذه السياسة', ['قد نحدّث هذه السياسة، وننشر تاريخ آخر تحديث في أعلى الصفحة. استمرارك في استخدام الخدمة بعد التحديث يعني قبولك له.']],
  ]],
  en: ['Privacy Policy', [
    ['Who we are', ['EMD Garage is a cloud system for managing car workshops and garages, provided by EMD in the Sultanate of Oman. This page explains what data we collect and why, and your rights over it.']],
    ['Data we collect', [
      'Account data: name, email, phone number and an encrypted password.',
      'Garage data entered by the owner and staff: customers and their phone numbers, vehicles with plate and chassis numbers, job orders, invoices and payments, stock, suppliers and expenses.',
      'Photos and files you upload: vehicle photos at intake, customer signature, expense receipts and supplier invoices, the garage logo and stamp.',
      'Basic technical data needed to run the service, such as sign-in time.']],
    ['Who owns the data', ['Each garage\'s data belongs to its owner. We process it only to run the service for them. We do not sell it or share it with anyone for marketing. Each garage is isolated; no garage can see another\'s data.']],
    ['How we use it', [
      'To run the app and show your data to you and your staff according to their permissions.',
      'To manage the subscription and contact you about the service.',
      'To improve the service and fix faults.',
      'We do not message the garage\'s customers. WhatsApp messages are sent by garage staff from their own phone.']],
    ['Where it is stored', ['Data is stored with a cloud hosting provider (Supabase) on secured servers and travels over an encrypted connection. The app keeps a temporary copy on your device to show when offline; it is cleared when you sign out.']],
    ['Customer tracking link', ['The garage creates a private link for each job order to send to the customer. Anyone with the link can see the car\'s status and that job\'s lines and prices only, without an account.']],
    ['Retention', ['We keep garage data while the subscription is active. After the subscription ends and deletion is requested, we delete it within 30 days, except financial and tax records the law requires us to keep.']],
    ['Your rights', [
      'View and correct your data inside the app at any time.',
      'Export a full copy of your garage data from the Settings page.',
      'Request deletion of your account and garage data, as described next.']],
    ['Deleting your account and data', ['To request deletion of your account or your garage\'s data, write to us from the email registered on your account using the contact below, and mention the garage name. We confirm the request and complete it within 30 days. If you are an employee of a garage, the work data belongs to the garage owner and we delete your personal account only.']],
    ['Children', ['The service is for business owners and their staff, and is not directed at anyone under 18.']],
    ['Changes to this policy', ['We may update this policy and will show the date of the last update at the top of the page. Continuing to use the service after an update means you accept it.']],
  ]],
};

const TERMS = {
  ar: ['شروط الاستخدام', [
    ['الخدمة', ['EMD Garage نظام سحابي لإدارة الكراجات يُقدَّم باشتراك. باستخدامك له توافق على هذه الشروط.']],
    ['الحساب', [
      'أنت مسؤول عن صحة بياناتك وعن سرية كلمة المرور.',
      'صاحب الكراج مسؤول عن موظفيه الذين يدعوهم وعن الصلاحيات التي يمنحها لهم.',
      'أبلغنا فوراً إن شككت في دخول غير مصرّح به.']],
    ['الفترة التجريبية والاشتراك', [
      'قد تبدأ الخدمة بفترة تجريبية مجانية تُحدَّد مدتها عند التسجيل.',
      'بعدها تستمر الخدمة باشتراك مدفوع حسب الخطة المتفق عليها.',
      'عند عدم التجديد قد يُوقَف الدخول إلى الكراج، وتبقى بياناته محفوظة مدة معقولة لتتمكن من تجديده أو تصدير بياناته.']],
    ['بياناتك', ['بيانات الكراج ملك لصاحبه. تستطيع تصديرها في أي وقت من الإعدادات. طريقة تعاملنا معها مبيّنة في سياسة الخصوصية.']],
    ['مسؤوليتك عن المحتوى', [
      'أنت مسؤول عن صحة ما تدخله من أسعار وفواتير وبيانات عملاء.',
      'التزامك بالأنظمة الضريبية والتجارية في بلدك مسؤوليتك. التطبيق أداة تساعدك وليس بديلاً عن المحاسب أو المستشار الضريبي.',
      'احصل على موافقة عملائك على حفظ بياناتهم وصور سياراتهم حيث يلزم ذلك.']],
    ['الاستخدام المقبول', [
      'لا تستخدم الخدمة لغرض غير مشروع.',
      'لا تحاول الوصول إلى بيانات كراج آخر أو تعطيل الخدمة.',
      'لا تُعد بيع الخدمة لغيرك دون اتفاق مكتوب معنا.']],
    ['توفّر الخدمة', ['نسعى لإبقاء الخدمة متاحة دائماً، لكنها قد تتوقف مؤقتاً للصيانة أو لأسباب خارجة عن إرادتنا. ننصحك بتصدير نسخة من بياناتك دورياً.']],
    ['حدود المسؤولية', ['تُقدَّم الخدمة كما هي. لا نتحمل مسؤولية خسائر غير مباشرة ناتجة عن استخدامها أو انقطاعها، وذلك في الحدود التي يسمح بها القانون.']],
    ['الإنهاء', ['تستطيع التوقف عن استخدام الخدمة وطلب حذف بياناتك في أي وقت. ولنا إيقاف حساب يخالف هذه الشروط بعد إشعاره.']],
    ['القانون المعمول به', ['تخضع هذه الشروط لقوانين سلطنة عُمان.']],
  ]],
  en: ['Terms of Use', [
    ['The service', ['EMD Garage is a cloud garage-management system offered by subscription. By using it you agree to these terms.']],
    ['Your account', [
      'You are responsible for the accuracy of your details and for keeping your password secret.',
      'The garage owner is responsible for the staff they invite and the permissions they grant.',
      'Tell us at once if you suspect unauthorised access.']],
    ['Trial and subscription', [
      'The service may start with a free trial whose length is set at sign-up.',
      'After that, it continues on a paid subscription under the agreed plan.',
      'If not renewed, access to the garage may be suspended; its data is kept for a reasonable time so you can renew or export it.']],
    ['Your data', ['Garage data belongs to its owner. You can export it at any time from Settings. How we handle it is described in the Privacy Policy.']],
    ['Your responsibility for content', [
      'You are responsible for the accuracy of the prices, invoices and customer data you enter.',
      'Complying with tax and commercial rules in your country is your responsibility. The app is a tool that helps you, not a substitute for an accountant or tax adviser.',
      'Obtain your customers\' consent to store their data and vehicle photos where required.']],
    ['Acceptable use', [
      'Do not use the service for unlawful purposes.',
      'Do not try to access another garage\'s data or disrupt the service.',
      'Do not resell the service without a written agreement with us.']],
    ['Availability', ['We aim to keep the service available at all times, but it may pause for maintenance or reasons beyond our control. We recommend exporting a copy of your data regularly.']],
    ['Limitation of liability', ['The service is provided as is. To the extent the law allows, we are not liable for indirect losses arising from its use or interruption.']],
    ['Termination', ['You may stop using the service and request deletion of your data at any time. We may suspend an account that breaks these terms after notifying it.']],
    ['Governing law', ['These terms are governed by the laws of the Sultanate of Oman.']],
  ]],
};

export default async function legal(which) {
  const L = isEn ? 'en' : 'ar';
  const [title, sections] = (which === 'terms' ? TERMS : PRIVACY)[L];
  const contact = await db.rpc('platform_contact').catch(() => null);
  const t = (ar, en) => (isEn ? en : ar);
  const wa = contact?.whatsapp ? String(contact.whatsapp).replace(/\D/g, '') : '';
  return {
    title,
    html: `<div class="legal" data-raw>
      <header class="legal-bar"><a href="#/"><img src="assets/logo-on-dark.svg" alt="EMD Garage"></a>
        <span class="row" style="gap:6px"><a class="btn small ghost" style="color:#fff" href="#/${which === 'terms' ? 'privacy' : 'terms'}">${t(which === 'terms' ? 'سياسة الخصوصية' : 'شروط الاستخدام', which === 'terms' ? 'Privacy Policy' : 'Terms of Use')}</a>${langButton('btn small ghost lang-btn')}</span></header>
      <article class="legal-doc">
        <h1>${esc(title)}</h1>
        <p class="subtle">${t('آخر تحديث', 'Last updated')}: ${UPDATED[L]}</p>
        ${sections.map(([h, ps]) => `<h2>${esc(h)}</h2>${ps.length > 1 ? `<ul>${ps.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : `<p>${esc(ps[0])}</p>`}`).join('')}
        <h2>${t('تواصل معنا', 'Contact us')}</h2>
        ${contact?.email || wa ? `<p>${contact?.email ? `${t('البريد', 'Email')}: <a href="mailto:${esc(contact.email)}"><bdi class="ltr">${esc(contact.email)}</bdi></a>` : ''}${contact?.email && wa ? '<br>' : ''}${wa ? `${t('واتساب', 'WhatsApp')}: <a href="https://wa.me/${wa}" target="_blank" rel="noopener"><bdi class="ltr">+${wa}</bdi></a>` : ''}</p>`
    : `<p>${t('تواصل مع الجهة التي زوّدتك بالخدمة.', 'Contact the party that provided you with the service.')}</p>`}
        <p><a class="btn" href="#/">${t('رجوع إلى التطبيق', 'Back to the app')}</a></p>
      </article></div>`,
  };
}
