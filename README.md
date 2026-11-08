# النشر التلقائي على inqelio.net (Blogger) عبر GitHub Actions

## محتويات المشروع
```
publish.js                      السكربت (Node 20، بدون مكتبات)
.github/workflows/publish.yml   الجدولة (كل 6 ساعات + تشغيل يدوي)
README.md                       هذا الشرح
```
مهم: ملف `publish.yml` يجب أن يكون داخل المجلد `.github/workflows/` بالضبط، وإلا لن يشتغل.

## الخطوة 1: إنشاء المستودع
1. أنشئ مستودعاً جديداً على GitHub (يمكن أن يكون Private).
2. ارفع الملفين `publish.js` و`.github/workflows/publish.yml` إليه.

## الخطوة 2: مفتاح Gemini
1. ادخل إلى https://aistudio.google.com/apikey وأنشئ مفتاحاً.
2. احفظه لاستخدامه كسر باسم `GEMINI_API_KEY`.

## الخطوة 3: تفعيل Blogger API وإنشاء OAuth
1. في https://console.cloud.google.com أنشئ مشروعاً جديداً.
2. من APIs & Services > Library فعّل **Blogger API v3**.
3. من OAuth consent screen:
   - اختر نوع External وأكمل البيانات الأساسية.
   - **مهم جداً:** اضغط **Publish app** لينتقل التطبيق إلى وضع "In production". إذا بقي في وضع Testing فإن refresh token ينتهي بعد 7 أيام ويتوقف النشر. ستظهر عند الموافقة شاشة تحذير "unverified app"، وهذا طبيعي لتطبيق خاص بحسابك، اختر Advanced ثم Continue.
4. من Credentials > Create credentials > OAuth client ID:
   - النوع: **Web application**
   - في Authorized redirect URIs أضف: `https://developers.google.com/oauthplayground`
   - احفظ **Client ID** و**Client Secret**.

## الخطوة 4: الحصول على refresh token (مرة واحدة)
1. ادخل إلى https://developers.google.com/oauthplayground
2. اضغط أيقونة الترس (⚙️) وفعّل **Use your own OAuth credentials**، ثم ضع Client ID وClient Secret.
3. في الخانة "Input your own scopes" اكتب: `https://www.googleapis.com/auth/blogger` ثم Authorize APIs.
4. سجّل الدخول بنفس حساب Google الذي يملك المدونة ووافق على الصلاحية.
5. اضغط **Exchange authorization code for tokens** وانسخ قيمة **Refresh token**.

## الخطوة 5: رقم المدونة (Blog ID)
افتح لوحة Blogger واختر المدونة، ثم خذ الرقم الظاهر بعد `blogID=` في رابط الصفحة.

## الخطوة 6: إضافة الأسرار في GitHub
من المستودع: Settings > Secrets and variables > Actions > **Secrets** > New repository secret. أضف:

| الاسم | القيمة |
|---|---|
| `GEMINI_API_KEY` | مفتاح Gemini |
| `GOOGLE_CLIENT_ID` | من الخطوة 3 |
| `GOOGLE_CLIENT_SECRET` | من الخطوة 3 |
| `GOOGLE_REFRESH_TOKEN` | من الخطوة 4 |
| `BLOGGER_BLOG_ID` | من الخطوة 5 |

## الخطوة 7: التجربة الأولى
1. من تبويب **Actions** اختر "Auto publish to Blogger" ثم **Run workflow**.
2. بعد دقائق افتح Blogger وراجع المقال في **المسودات**. القيمة الافتراضية `IS_DRAFT=true` تحفظ المقال كمسودة ولا تنشره.
3. إذا أعجبتك الجودة، اذهب إلى Settings > Secrets and variables > Actions > **Variables** وأنشئ متغيراً باسم `IS_DRAFT` وقيمته `false` ليبدأ النشر المباشر.

## متغيرات اختيارية (من تبويب Variables)
| المتغير | الاستخدام | الافتراضي |
|---|---|---|
| `LANGUAGE` | لغة المقالات | Arabic |
| `CATEGORIES` | التصنيفات مفصولة بفاصلة | Technology,Artificial Intelligence,Tips and Tutorials,Reviews,News |
| `IS_DRAFT` | `false` للنشر المباشر | true |
| `GEMINI_MODEL` | اسم نموذج Gemini | gemini-2.5-flash |

غيّر `LANGUAGE` و`CATEGORIES` لتناسب موقعك. وإذا ظهر خطأ بأن النموذج غير موجود فضع اسم نموذج متاحاً حالياً في `GEMINI_MODEL`.

## تغيير الجدولة
في `publish.yml` عدّل سطر `cron`. أمثلة (بتوقيت UTC):
- كل 12 ساعة: `0 */12 * * *`
- مرة يومياً الساعة 8: `0 8 * * *`

## ما يفعله السكربت
- يختار التصنيف عشوائياً من الكود، لأن النماذج اللغوية ليست عشوائية فعلاً.
- يقرأ آخر 30 عنواناً من المدونة ويطلب من Gemini تجنب تكرار المواضيع.
- يعيد المحاولة تلقائياً عند أخطاء Gemini المؤقتة.
- لا ينشر إذا كان المقال قصيراً بشكل مريب.

## حدود يجب معرفتها
- Blogger API لا يسمح بتحديد الرابط (slug) ولا الوصف (meta description). يطبع السكربت القيمتين في سجل التشغيل لتنسخهما يدوياً إن أردت.
- المقالات المولّدة تحتاج مراجعة بشرية، لأن الذكاء الاصطناعي قد يخطئ في المعلومات. راجع المسودات أولاً قبل النشر المباشر، وتجنب النشر الكثيف دون إشراف.
- إذا لم يكن في المستودع أي نشاط لفترة طويلة، قد يوقف GitHub الجدولة تلقائياً. ادخل إلى تبويب Actions وفعّلها من جديد.
