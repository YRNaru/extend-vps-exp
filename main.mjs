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

let hasError = false
let errorMessage = ''

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

    log('📸 [スクリーンショット1] キャプチャ画像表示ページを撮影中...')
    await page.screenshot({ path: 'screenshots/01_captcha_display.png' })
    log('✅ screenshots/01_captcha_display.png に保存完了')

    log('⏳ キャプチャ画像を抽出中...')
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
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

    log('📸 [スクリーンショット2] キャプチャコード入力後のページを撮影中...')
    await page.screenshot({ path: 'screenshots/03_before_final_button.png' })
    log('✅ screenshots/03_before_final_button.png に保存完了')
    log('ℹ️  このスクリーンショットで、認識されたコードが正しく入力されているか確認できます')

    log('⏳ 最終確認ボタンをクリック...')
    await page.$eval('button[formaction="/xapanel/xvps/server/freevps/extend/do"]', btn => btn.click())
    log('✅ 最終確認ボタンクリック完了')

    // ボタンクリック直後に少し待機
    await setTimeout(2000)

    log('📸 [スクリーンショット3] ボタンクリック後のページを撮影中...')
    await page.screenshot({ path: 'screenshots/04_after_button_click.png' })
    log('✅ screenshots/04_after_button_click.png に保存完了')
    log('⭐ このスクリーンショットを確認して、ボタンの構造をお教えください！')

    // ページのHTMLを取得して保存（デバッグ用）
    const html = await page.content()
    writeFileSync('screenshots/05_page_html.txt', html, 'utf-8')
    log('✅ screenshots/05_page_html.txt に保存完了 (ページ全体のHTML)')

    // ボタンを探す
    log('🔍 ページ内のボタンを検索中...')
    const buttons = await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'))
        return allButtons.map(btn => ({
            id: btn.id,
            class: btn.className,
            text: btn.innerText.trim(),
            type: btn.type,
            html: btn.outerHTML.substring(0, 200)
        }))
    })
    
    writeFileSync('screenshots/06_buttons_found.json', JSON.stringify(buttons, null, 2), 'utf-8')
    log('✅ screenshots/06_buttons_found.json に保存完了')
    log('📋 ページ内のボタン一覧:')
    buttons.forEach((btn, idx) => {
        log(`   [${idx}] ID: "${btn.id}" | Class: "${btn.class}" | Text: "${btn.text}"`)
    })

    // modalDo__close ボタンを探す（タイムアウトなし）
    log('⏳ OKボタンを検索中...')
    const okButtonExists = await page.$('button#modalDo__close')
    if (okButtonExists) {
        log('✅ button#modalDo__close が見つかりました！')
        await page.$eval('button#modalDo__close', btn => btn.click())
        log('✅ OKボタンクリック完了')
    } else {
        log('⚠️ button#modalDo__close が見つかりません')
        log('🔍 他のボタンセレクターを試します...')
        
        // 代替案1: IDで検索
        const idMatch = buttons.find(btn => btn.id && (btn.id.includes('ok') || btn.id.includes('close') || btn.id.includes('modal')))
        if (idMatch) {
            log(`   見つかった: ID="${idMatch.id}"`)
            await page.$eval(`button#${idMatch.id}`, btn => btn.click())
            log('✅ 代替ボタンをクリック完了')
        } else {
            log('   ID検索でも見つかりません')
            
            // 代替案2: テキストで検索
            const textMatch = buttons.find(btn => btn.text === 'OK')
            if (textMatch) {
                log(`   見つかった: Text="${textMatch.text}"`)
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'OK')
                    if (btn) btn.click()
                })
                log('✅ OK テキストボタンをクリック完了')
            } else {
                log('⚠️ OKボタンが見つかないため、スキップします')
                log('💡 スクリーンショット 04_after_button_click.png を確認して、ボタンの構造を確認してください')
            }
        }
    }

    log('⏳ 最終的なページ遷移を待機中...')
    await page.waitForNavigation({ 
        waitUntil: 'networkidle0',
        timeout: 60000 
    }).catch(() => {
        log('⚠️ ナビゲーション失敗（ページ遷移なし）- 続行します')
        return true
    })
    
    log('📸 [スクリーンショット4] 最終確認ページを撮影中...')
    await page.screenshot({ path: 'screenshots/07_final_page.png' })
    log('✅ screenshots/07_final_page.png に保存完了')

    log('✅ ✅ ✅ VPS更新処理完了！！！')

} catch (e) {
    hasError = true
    errorMessage = e.message
    console.error('❌ エラーが発生しました:')
    console.error(e.message)
    console.error(e.stack)
    
    // エラー時もスクリーンショット撮る
    try {
        log('📸 エラー発生時の画面を撮影中...')
        await page.screenshot({ path: 'screenshots/ERROR_page.png' })
        log('✅ screenshots/ERROR_page.png に保存完了')
    } catch (screenshotError) {
        log('⚠️ エラー画面のスクリーンショット撮影に失敗')
    }

} finally {
    try {
        await setTimeout(2000)
        await recorder.stop()
        await browser.close()
        log('🛑 ブラウザを終了しました')
        
        log('📁 スクリーンショットとデバッグ情報は screenshots/ ディレクトリに保存されました')
        
        if (hasError) {
            log('')
            log('⚠️ エラーが発生しましたが、以下のファイルで詳細を確認できます:')
            log('   📸 screenshots/04_after_button_click.png ← ボタン後の画面')
            log('   📋 screenshots/06_buttons_found.json ← ボタン一覧')
            log('   📄 screenshots/05_page_html.txt ← ページのHTML')
            log('')
            log(`   エラーメッセージ: ${errorMessage}`)
            log('')
        } else {
            log('✅ 処理成功！以下のファイルが生成されました:')
            log('   01_captcha_display.png')
            log('   02_captcha_image_extracted.png')
            log('   03_before_final_button.png')
            log('   04_after_button_click.png')
            log('   05_page_html.txt')
            log('   06_buttons_found.json')
            log('   07_final_page.png')
        }
        
    } catch (finallyError) {
        console.error('⚠️ finally ブロック内でエラー:', finallyError)
    }
    
    // process.exit() を遅延させて、ファイル保存を完了させる
    setTimeout(() => {
        process.exit(hasError ? 1 : 0)
    }, 1000)
}
