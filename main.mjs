import { addExtra } from 'puppeteer-extra'
import puppeteerCore from 'puppeteer'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { setTimeout } from 'node:timers/promises'
import { writeFileSync, mkdirSync } from 'fs'

const puppeteer = addExtra(puppeteerCore)
puppeteer.use(StealthPlugin())

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
const recorder = await page.screencast({ path: 'recording.webm' })

const log = (step) => console.log(`[${new Date().toISOString()}] ${step}`)

mkdirSync('screenshots', { recursive: true })

let hasError = false
let errorMessage = ''
let vpsDetailUrl = ''

// Cloudflare Turnstileをクリックし、トークンが現れるまでポーリングする
async function waitForCloudflareTurnstile() {
    // ── Step1: Cloudflare iframeをクリック ──
    await setTimeout(2000)
    const frames = page.frames()
    log(`🔍 フレーム数: ${frames.length}`)

    for (const frame of frames) {
        if (frame.url().includes('challenges.cloudflare.com')) {
            log(`🔍 Cloudflareフレーム発見: ${frame.url().substring(0, 80)}...`)
            try {
                const frameElement = await frame.frameElement()
                const box = await frameElement.boundingBox()
                if (box) {
                    log(`📍 iframe座標: x=${box.x.toFixed(0)}, y=${box.y.toFixed(0)}, w=${box.width.toFixed(0)}, h=${box.height.toFixed(0)}`)
                    // チェックボックス位置をクリック（左端から25px、縦中央）
                    await page.mouse.click(box.x + 25, box.y + box.height / 2)
                    log('✅ Cloudflare Turnstile: クリック実行')
                }
            } catch (e) {
                log(`⚠️ クリック失敗: ${e.message}`)
            }
            break
        }
    }

    // ── Step2: cf-turnstile-response トークンが現れるまでポーリング ──
    log('⏳ cf-turnstile-response トークンを待機中（最大60秒）...')
    for (let i = 0; i < 30; i++) {
        await setTimeout(2000)
        try {
            const token = await page.evaluate(() => {
                const el = document.querySelector('[name="cf-turnstile-response"]')
                return el ? el.value : ''
            })
            if (token && token.length > 10) {
                log(`✅ Cloudflareトークン取得成功！（${(i + 1) * 2}秒後, 長さ=${token.length}）`)
                return true
            }
        } catch {}
    }

    // タイムアウト時の診断情報
    log('⚠️ タイムアウト: Cloudflareトークンが取得できませんでした')
    try {
        const tokenVal = await page.evaluate(() => {
            const el = document.querySelector('[name="cf-turnstile-response"]')
            return el ? `value="${el.value}" (長さ=${el.value.length})` : '要素が見つかりません'
        })
        log(`🔍 cf-turnstile-response の状態: ${tokenVal}`)
    } catch (e) {
        log(`🔍 cf-turnstile-response チェック失敗: ${e.message}`)
    }
    return false
}

try {
    log('✅ ブラウザ起動完了（Stealthモード）')

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

    await page.locator('#memberid').setTimeout(60000).fill(process.env.EMAIL)
    await page.locator('#user_password').setTimeout(60000).fill(process.env.PASSWORD)
    log('⏳ ログインボタンをクリック...')
    await page.locator('text=ログインする').setTimeout(60000).click()
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

        await page.locator('text=更新する').setTimeout(60000).click()
        log('✅ 更新ボタンクリック完了')
        await page.locator('text=引き続き無料VPSの利用を継続する').setTimeout(60000).click()
        log('✅ 利用継続ボタンクリック完了')

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        log('✅ キャプチャページ読込完了')

        await page.waitForSelector('img[src^="data:"]', { timeout: 60000 })
        log('✅ キャプチャ画像確認')

        const body = await page.$eval('img[src^="data:"]', img => img.src)
        writeFileSync(
            `screenshots/02_captcha_image_retry${retryCount}.png`,
            Buffer.from(body.replace(/^data:image\/[^;]+;base64,/, ''), 'base64')
        )
        log('✅ キャプチャ画像抽出完了')

        log('⏳ AIでキャプチャを解析中...')
        const code = await fetch('https://captcha-120546510085.asia-northeast1.run.app', {
            method: 'POST',
            body
        }).then(r => r.text())
        log(`✅ キャプチャ解析完了: ${code}`)

        await page.locator('[placeholder="上の画像の数字を入力"]').setTimeout(60000).fill(code)
        log(`✅ コード「${code}」を入力完了`)

        // Cloudflare Turnstile クリック＆トークン待機
        log('⏳ Cloudflare Turnstile処理中...')
        const cfPassed = await waitForCloudflareTurnstile()
        log(cfPassed
            ? '✅ Cloudflare認証成功！フォームを送信します'
            : '⚠️ Cloudflare認証未完了のままフォーム送信を試みます（診断のため）'
        )

        await page.screenshot({ path: `screenshots/03_after_cloudflare_wait_retry${retryCount}.png` })
        log(`✅ screenshots/03_after_cloudflare_wait_retry${retryCount}.png に保存完了`)

        log('⏳ 最終確認ボタンをクリック...')
        await page.$eval('button[formaction="/xapanel/xvps/server/freevps/extend/do"]', btn => {
            btn.removeAttribute('disabled')
            btn.click()
        })
        log('✅ 最終確認ボタンクリック完了')

        await setTimeout(3000)

        const errorMessageExists = await page.$eval('body', b =>
            b.innerText.includes('認証に失敗しました')
        ).catch(() => false)

        if (errorMessageExists) {
            log(`⚠️ 認証に失敗しました（試行 ${retryCount}/${maxRetries}）`)
            if (retryCount < maxRetries) {
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

    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {
        log('⚠️ ナビゲーション失敗（ページ遷移なし）- 続行します')
        return true
    })

    await page.screenshot({ path: 'screenshots/07_final_page.png' })
    log('✅ screenshots/07_final_page.png に保存完了')
    log('✅ ✅ ✅ VPS更新処理完了！！！')

} catch (e) {
    hasError = true
    errorMessage = e.message
    console.error('❌ エラーが発生しました:', e.message)
    console.error(e.stack)
    try {
        await page.screenshot({ path: 'screenshots/ERROR_page.png' })
        log('✅ screenshots/ERROR_page.png に保存完了')
    } catch { log('⚠️ エラー画面のスクリーンショット撮影に失敗') }

} finally {
    try {
        await setTimeout(2000)
        await recorder.stop()
        await browser.close()
        log('🛑 ブラウザを終了しました')
        log(hasError ? `⚠️ エラー: ${errorMessage}` : '✅ 処理成功！')
    } catch (e) {
        console.error('⚠️ finally エラー:', e)
    }
    globalThis.setTimeout(() => process.exit(hasError ? 1 : 0), 1000)
}
