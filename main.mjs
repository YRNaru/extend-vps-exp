import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const args = ['--no-sandbox', '--disable-setuid-sandbox']
if (process.env.PROXY_SERVER) {
    const proxy_url = new URL(process.env.PROXY_SERVER)
    proxy_url.username = ''
    proxy_url.password = ''
    args.push(`--proxy-server=${proxy_url}`.replace(/\/$/, ''))
}

const browser = await puppeteer.launch({
    defaultViewport: { width: 1080, height: 1024 },
    args,
})

const [page] = await browser.pages()
const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))
const recorder = await page.screencast({ path: 'recording.webm' })

const log = (step) => console.log(`[${new Date().toISOString()}] ${step}`)

// スクリーンショット保存ディレクトリ作成
mkdirSync('screenshots', { recursive: true })

try {
    log('✅ ブラウザ起動完了')

    if (process.env.PROXY_SERVER) {
        const { username, password } = new URL(process.env.PROXY_SERVER)
        if (username && password) {
            await page.authenticate({ username, password })
        }
    }

    log('⏳ ログインページへアクセス中...')
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', {
        waitUntil: 'networkidle2',
        timeout: 60000
    })
    log('✅ ログインページ読込完了')

    log('⏳ ログイン情報を入力中...')
    await page.locator('#memberid').setTimeout(60000).fill(process.env.EMAIL)
    await page.locator('#user_password').setTimeout(60000).fill(process.env.PASSWORD)

    log('⏳ ログインボタンをクリック...')
    await page.locator('text=ログインする').setTimeout(60000).click()

    log('⏳ ログイン後のページ読込を待機中...')
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    log('✅ ログイン完了')

    log('⏳ VPS詳細ページへ移動中...')
    await page.locator('a[href^="/xapanel/xvps/server/detail?id="]').setTimeout(60000).click()
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    log('✅ VPS詳細ページ読込完了')

    log('⏳ 更新ボタンをクリック...')
    await page.locator('text=更新する').setTimeout(60000).click()
    log('✅ 更新ボタンクリック完了')

    log('⏳ 利用継続ボタンをクリック...')
    await page.locator('text=引き続き無料VPSの利用を継続する').setTimeout(60000).click()
    log('✅ 利用継続ボタンクリック完了')

    log('⏳ キャプチャページの読込を待機中...')
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    log('✅ キャプチャページ読込完了')

    log('⏳ キャプチャ画像の出現を待機中...')
    await page.waitForSelector('img[src^="data:"]', { timeout: 60000 })
    log('✅ キャプチャ画像確認')

    // 📸 スクリーンショット1: キャプチャ画像が表示されている状態
    log('📸 [スクリーンショット1] キャプチャ画像表示ページを撮影中...')
    const screenshot1 = await page.screenshot({ path: 'screenshots/01_captcha_display.png' })
    log('✅ screenshots/01_captcha_display.png に保存完了')

    log('⏳ キャプチャ画像を抽出中...')
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    // キャプチャ画像をBase64から画像ファイルに変換して保存
    const base64Data = body.replace(/^data:image\/[^;]+;base64,/, '')
    const captchaImageBuffer = Buffer.from(base64Data, 'base64')
    writeFileSync('screenshots/02_captcha_image_extracted.png', captchaImageBuffer)
    log('✅ screenshots/02_captcha_image_extracted.png に保存完了 (抽出したキャプチャ画像)')

    log('✅ キャプチャ画像抽出完了')

    log('⏳ AIでキャプチャを解析中...')
    const code = await fetch('https://captcha-120546510085.asia-northeast1.run.app', {
        method: 'POST',
        body
    }).then(r => r.text())
    log(`✅ キャプチャ解析完了: ${code}`)

    log('⏳ キャプチャコードを入力中...')
    await page.locator('[placeholder="上の画像の数字を入力"]').setTimeout(60000).fill(code)
    log(`✅ コード「${code}」を入力完了`)

    log('⏳ Cloudflare認証の完了を待機中...')
    await setTimeout(5000)
    log('✅ 待機完了')

    // 📸 スクリーンショット2: キャプチャコード入力後（最終確認ボタン前）
    log('📸 [スクリーンショット2] キャプチャコード入力後のページを撮影中...')
    const screenshot2 = await page.screenshot({ path: 'screenshots/03_before_final_button.png' })
    log('✅ screenshots/03_before_final_button.png に保存完了')
    log('ℹ️  このスクリーンショットで、認識されたコードが正しく入力されているか確認できます')

    log('⏳ 最終確認ボタンをクリック...')
    await page.$eval('button[formaction="/xapanel/xvps/server/freevps/extend/do"]', btn => btn.click())
    log('✅ 最終確認ボタンクリック完了')

    log('⏳ 完了ダイアログの出現を待機中...')
    await page.waitForSelector('button#modalDo__close', { timeout: 30000 })
    log('✅ 完了ダイアログ確認')

    // 📸 スクリーンショット3: 完了ダイアログ
    log('📸 [スクリーンショット3] 完了ダイアログを撮影中...')
    const screenshot3 = await page.screenshot({ path: 'screenshots/04_completion_dialog.png' })
    log('✅ screenshots/04_completion_dialog.png に保存完了')

    log('⏳ ダイアログの「OK」ボタンをクリック...')
    await page.$eval('button#modalDo__close', btn => btn.click())
    log('✅ OKボタンクリック完了')

    log('⏳ 最終的なページ遷移を待機中...')
    await page.waitForNavigation({ 
        waitUntil: 'networkidle0',
        timeout: 60000 
    }).catch(() => {
        log('⚠️ ナビゲーション失敗（ページ遷移なし）- 続行します')
        return true
    })
    
    // 📸 スクリーンショット4: 最終確認ページ
    log('📸 [スクリーンショット4] 最終確認ページを撮影中...')
    const screenshot4 = await page.screenshot({ path: 'screenshots/05_final_page.png' })
    log('✅ screenshots/05_final_page.png に保存完了')

    log('✅ ✅ ✅ VPS更新完了！！！')
    log('📁 スクリーンショットは screenshots/ ディレクトリに保存されました')
    log('   01_captcha_display.png - キャプチャ画像表示ページ')
    log('   02_captcha_image_extracted.png - AIが認識したキャプチャ画像')
    log('   03_before_final_button.png - キャプチャコード入力後')
    log('   04_completion_dialog.png - 完了ダイアログ')
    log('   05_final_page.png - 最終確認ページ')

} catch (e) {
    console.error('❌ エラーが発生しました:')
    console.error(e.message)
    console.error(e.stack)
    process.exit(1)
} finally {
    await setTimeout(5000)
    await recorder.stop()
    await browser.close()
    log('🛑 ブラウザを終了しました')
}
