import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { redirect_uri, state, scope } = body

    if (!redirect_uri) {
      return NextResponse.json(
        { error: 'Missing redirect_uri' },
        { status: 400 }
      )
    }

    const keycloakUrl = (process.env.KEYCLOAK_URL || 'https://vgurukool.com/keycloak').replace(/\/+$/, '')
    const realm = process.env.KEYCLOAK_REALM || 'cnoe'
    const clientId = process.env.KEYCLOAK_CLIENT_ID || 'vgurukool-apps'

    const keycloakAuthUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth`)
    keycloakAuthUrl.searchParams.set('client_id', clientId)
    keycloakAuthUrl.searchParams.set('redirect_uri', redirect_uri)
    keycloakAuthUrl.searchParams.set('response_type', 'code')
    keycloakAuthUrl.searchParams.set('scope', scope || 'openid email profile')
    keycloakAuthUrl.searchParams.set('state', state || '')

    return NextResponse.json({ url: keycloakAuthUrl.toString() })
  } catch (error: any) {
    console.error('Keycloak authorize error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
