import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'
import { writeFileSync, mkdirSync } from 'fs'

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

mkdirSync('screenshots', { recursive: true })

let hasError = false
let errorMessage = ''
let vpsDetailUrl = ''

// Cloudflare Turnstileウィジェットをクリックする関数
async function clickCloudflareTurnstile() {
    // Turnstileの読み込みを待つ
    await setTimeout(3000)

    const frames = page.frames()
    log(`🔍 フレーム数: ${frames.length}`)

    for (const frame of frames) {
        const frameUrl = frame.url()
        if (frameUrl.includes('challenges.cloudflare.com')) {
            log(`🔍 Cloudflareフレーム発見: ${frameUrl.substring(0, 80)}...`)

            // ── 方法1: frameElement() でDOM要素を取得し座標クリック ──
            try {
                const frameElement = await frame.frameElement()
                if (frameElement) {
                    const box = await frameElement.boundingBox()
                    if (box) {
                        log(`📍 iframe座標: x=${box.x.toFixed(0)}, y=${box.y.toFixed(0)}, w=${box.width.toFixed(0)}, h=${box.height.toFixed(0)}`)
                        // チェックボックスはウィジェット左端にある（左から25px、縦中央）
                        await page.mouse.click(box.x + 25, box.y + box.height / 2)
                        log('✅ Cloudflare Turnstile: 座標クリック成功')
                        return true
                    }
                }
            } catch (e) {
                log(`⚠️ 座標クリック失敗: ${e.message}`)
            }

            // ── 方法2: フレーム内セレクタを順番に試す ──
            const selectors = [
                'div[role="checkbox"]',
                'label',
                '.ctp-checkbox',
                '.cb-lb',
                'input',
                'span',
                'body',
            ]
            for (const sel of selectors) {
                try {
                    await frame.waitForSelector(sel, { timeout: 2000 })
                    await frame.click(sel)
                    log(`✅ Cloudflare Turnstile: セレクタ "${sel}" でクリック成功`)
                    return true
                } catch {
                    // 次のセレクタを試す
                }
            }

            log('⚠️ フレーム内のどのセレクタもクリックできませんでした')
            return false
        }
    }

    log('⚠️ Cloudflareフレームが見つかりませんでした')
    return false
}

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
    vpsDetailUrl = page.url()
    log(`✅ VPS詳細ページ読込完了: ${vpsDetailUrl}`)

    let retryCount = 0
    const maxRetries = 3
    let captchaSucceeded = false

    while (retryCount < maxRetries && !captchaSucceeded) {
        retryCount++
        log(`\n🔄 キャプチャ認証 試行 ${retryCount}/${maxRetries}`)

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

        log('⏳ キャプチャ画像を抽出中...')
        const body = await page.$eval('img[src^="data:"]', img => img.src)
        const base64Data = body.replace(/^data:image\/[^;]+;base64,/, '')
        const captchaImageBuffer = Buffer.from(base64Data, 'base64')
        writeFileSync(`screenshots/02_captcha_image_retry${retryCount}.png`, captchaImageBuffer)
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

        // Cloudflare Turnstile をクリック
        log('⏳ Cloudflare Turnstileをクリック中...')
        const clicked = await clickCloudflareTurnstile()
        if (clicked) {
            log('✅ Cloudflare Turnstileクリック完了 - 認証完了を待機中...')
        } else {
            log('⚠️ Cloudflare Turnstileクリック未完了 - このまま待機します...')
        }

        log('⏳ Cloudflare認証の完了を待機中...')
        await setTimeout(60000)
        log('✅ 待機完了')

        log('📸 Cloudflare検証完了後の画面をスクリーンショット中...')
        await page.screenshot({ path: `screenshots/03_after_cloudflare_wait_retry${retryCount}.png` })
        log(`✅ screenshots/03_after_cloudflare_wait_retry${retryCount}.png に保存完了`)

        log('⏳ 最終確認ボタンをクリック...')
        await page.$eval('button[formaction="/xapanel/xvps/server/freevps/extend/do"]', btn => {
            btn.removeAttribute('disabled')
            btn.click()
        })
        log('✅ 最終確認ボタンクリック完了')

        await setTimeout(3000)

        log('🔍 認証結果を確認中...')
        const errorMessageExists = await page.$eval('body', body => {
            return body.innerText.includes('認証に失敗しました')
        }).catch(() => false)

        if (errorMessageExists) {
            log(`⚠️ 認証に失敗しました（試行 ${retryCount}/${maxRetries}）`)
            if (retryCount < maxRetries) {
                log('🔄 VPS詳細ページに戻ってリトライします...')
                await page.goto(vpsDetailUrl, { waitUntil: 'networkidle2', timeout: 60000 })
                log('✅ VPS詳細ページに戻りました')
            }
        } else {
            log('✅ 認証に成功しました！')
            captchaSucceeded = true
        }
    }

    if (!captchaSucceeded) {
        throw new Error(`${maxRetries}回の試行後も認証に失敗しました`)
    }

    log('⏳ 最終的なページ遷移を待機中...')
    await page.waitForNavigation({
        waitUntil: 'networkidle0',
        timeout: 60000
    }).catch(() => {
        log('⚠️ ナビゲーション失敗（ページ遷移なし）- 続行します')
        return true
    })

    log('📸 最終確認ページを撮影中...')
    await page.screenshot({ path: 'screenshots/07_final_page.png' })
    log('✅ screenshots/07_final_page.png に保存完了')

    log('✅ ✅ ✅ VPS更新処理完了！！！')

} catch (e) {
    hasError = true
    errorMessage = e.message
    console.error('❌ エラーが発生しました:')
    console.error(e.message)
    console.error(e.stack)

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
            log('⚠️ エラーが発生しました')
            log(`   エラーメッセージ: ${errorMessage}`)
            log('')
        } else {
            log('✅ 処理成功！')
        }
    } catch (finallyError) {
        console.error('⚠️ finally ブロック内でエラー:', finallyError)
    }

    globalThis.setTimeout(() => {
        process.exit(hasError ? 1 : 0)
    }, 1000)
}
